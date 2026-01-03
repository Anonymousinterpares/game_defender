import { World } from '../World';
import { Player } from '../../entities/Player';
import { Enemy } from '../../entities/Enemy';
import { Projectile, ProjectileType } from '../../entities/Projectile';
import { Entity } from '../Entity';
import { WorldClock } from '../WorldClock';
import { LightManager } from '../LightManager';
import { VisibilitySystem, Point } from '../VisibilitySystem';
import { ConfigManager } from '../../config/MasterConfig';
import { MoltenMetalParticle } from '../../entities/Particle';

export interface LightingParent {
    world: World | null;
    player: Player | null;
    enemies: Enemy[];
    projectiles: Projectile[];
    particles: Entity[];
    cameraX: number;
    cameraY: number;
    isFiringBeam: boolean;
    isFiringFlamethrower: boolean;
    beamEndPos: { x: number, y: number };
}

export class LightingRenderer {
    private fogCanvas: HTMLCanvasElement | null = null;
    private fogCtx: CanvasRenderingContext2D | null = null;
    private lightCanvas: HTMLCanvasElement | null = null;
    private lightCtx: CanvasRenderingContext2D | null = null;
    
    private shadowChunks: Map<string, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, version: string }> = new Map();
    private chunkSize: number = 512;
    private lightPolygonCache: Map<string, Point[]> = new Map();
    private meshVersion: number = 0;

    constructor(private parent: LightingParent) {
        this.fogCanvas = document.createElement('canvas');
        this.fogCtx = this.fogCanvas.getContext('2d');
        this.lightCanvas = document.createElement('canvas');
        this.lightCtx = this.lightCanvas.getContext('2d');
    }

    public render(ctx: CanvasRenderingContext2D): void {
        this.renderLighting(ctx);
    }

    private renderLighting(ctx: CanvasRenderingContext2D): void {
        const lightingEnabled = ConfigManager.getInstance().get<boolean>('Lighting', 'enabled');
        if (!lightingEnabled || !this.lightCanvas || !this.lightCtx || !this.parent.world) return;

        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        if (this.lightCanvas.width !== w || this.lightCanvas.height !== h) {
            this.lightCanvas.width = w; this.lightCanvas.height = h;
        }

        const { ambientIntensity, sunColor, sunDirection, moonDirection, moonIntensity, moonShadowLen, isDaylight } = WorldClock.getInstance().getTimeState();
        const worldMeshVersion = this.parent.world.getMeshVersion();
        
        // Use either sun or moon for shadows
        const activeDir = isDaylight ? sunDirection : moonDirection;
        const activeIntensity = isDaylight ? ambientIntensity : moonIntensity;
        const activeAngle = Math.atan2(activeDir.y, activeDir.x);
        
        const bakeVersion = `${worldMeshVersion}_${Math.round(activeAngle * 10)}_${isDaylight ? 'D' : 'N'}_${Math.round(activeIntensity * 10)}`; 

        const lctx = this.lightCtx;
        lctx.globalCompositeOperation = 'source-over'; 
        
        // Step 1: Base Ambient (Always applied)
        lctx.fillStyle = sunColor;
        lctx.fillRect(0, 0, w, h);

        // Step 2: Shadows (Either Sun or Moon)
        // Shadows are painted with 'multiply' or similar on the light map if we want them to subtract
        // but currently rebuildShadowChunk draws them directly. We'll stick to direct for now
        // but we'll ensure moon shadows are lighter.

        const startGX = Math.floor(this.parent.cameraX / this.chunkSize);
        const startGY = Math.floor(this.parent.cameraY / this.chunkSize);
        const endGX = Math.floor((this.parent.cameraX + w) / this.chunkSize);
        const endGY = Math.floor((this.parent.cameraY + h) / this.chunkSize);

        for (let gy = startGY; gy <= endGY; gy++) {
            for (let gx = startGX; gx <= endGX; gx++) {
                const key = `${gx},${gy}`;
                let chunk = this.shadowChunks.get(key);
                if (!chunk) {
                    const canvas = document.createElement('canvas');
                    canvas.width = this.chunkSize;
                    canvas.height = this.chunkSize;
                    chunk = { canvas, ctx: canvas.getContext('2d')!, version: '' };
                    this.shadowChunks.set(key, chunk);
                }
                if (chunk.version !== bakeVersion) {
                    if (isDaylight) {
                        this.rebuildShadowChunk(chunk, gx, gy, sunDirection, ambientIntensity);
                    } else {
                        this.rebuildMoonShadowChunk(chunk, gx, gy, moonDirection, moonIntensity, moonShadowLen);
                    }
                    chunk.version = bakeVersion;
                }
                lctx.drawImage(chunk.canvas, gx * this.chunkSize - this.parent.cameraX, gy * this.chunkSize - this.parent.cameraY);
            }
        }

        // Dynamic Entity Shadows
        if (isDaylight) {
            const shadowLen = 20 + 150 * (1.0 - Math.pow(ambientIntensity, 0.4));
            if (ambientIntensity > 0.1) {
                lctx.save();
                lctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                const entitiesToShadow = [];
                if (this.parent.player) {
                    entitiesToShadow.push(this.parent.player);
                    entitiesToShadow.push(...this.parent.player.segments);
                }
                entitiesToShadow.push(...this.parent.enemies);
                entitiesToShadow.forEach(e => {
                    if (e.active) this.renderEntityShadow(lctx, e, sunDirection, shadowLen);
                });
                lctx.restore();
            }
        } else if (moonIntensity > 0.1) {
            lctx.save();
            lctx.fillStyle = `rgba(0, 0, 0, ${0.4 * moonIntensity})`;
            const entitiesToShadow = [];
            if (this.parent.player) {
                entitiesToShadow.push(this.parent.player);
                entitiesToShadow.push(...this.parent.player.segments);
            }
            entitiesToShadow.push(...this.parent.enemies);
            entitiesToShadow.forEach(e => {
                if (e.active) this.renderEntityShadow(lctx, e, moonDirection, moonShadowLen);
            });
            lctx.restore();
        }

        // Step 2.5: Un-shadow casters (Punch holes in shadows so objects aren't covered by them)
        lctx.save();
        lctx.globalCompositeOperation = 'source-over';
        lctx.translate(-this.parent.cameraX, -this.parent.cameraY);
        // Using white ensures the vision light correctly screens on top of the objects
        this.parent.world.renderAsSilhouette(lctx, this.parent.cameraX, this.parent.cameraY, '#ffffff');
        if (this.parent.player) this.parent.player.renderAsSilhouette(lctx, '#ffffff');
        this.parent.enemies.forEach(e => e.renderAsSilhouette(lctx, '#ffffff'));
        lctx.restore();

        // Step 3: Night Vision (Player Vision as a Reveal Light)
        if (!isDaylight && this.parent.player) {
            lctx.save();
            lctx.globalCompositeOperation = 'screen'; // Additive reveal
            this.renderVisionLight(lctx);
            lctx.restore();
        }

        // Step 4: Dynamic Lights
        if (ambientIntensity < 0.95) {
            const lights = LightManager.getInstance().getLights();
            const segments = this.parent.world.getOcclusionSegments(this.parent.cameraX, this.parent.cameraY, w, h);
            
            const shadowLights = lights.filter(l => l.castsShadows);
            const glowLights = lights.filter(l => !l.castsShadows);

            shadowLights.forEach(light => {
                const screenX = light.x - this.parent.cameraX;
                const screenY = light.y - this.parent.cameraY;
                if (screenX < -light.radius || screenX > w + light.radius || 
                    screenY < -light.radius || screenY > h + light.radius) return;

                lctx.save();
                lctx.globalCompositeOperation = 'screen';
                lctx.globalAlpha = light.intensity * (1.0 - ambientIntensity * 0.5);

                let polygon = this.lightPolygonCache.get(light.id);
                const lastPos = (light as any)._lastShadowPos || {x: 0, y: 0};
                const lightMoved = Math.abs(light.x - lastPos.x) > 2 || Math.abs(light.y - lastPos.y) > 2;

                if (!polygon || worldMeshVersion !== this.meshVersion || lightMoved) {
                    polygon = VisibilitySystem.calculateVisibility({x: light.x, y: light.y}, segments);
                    this.lightPolygonCache.set(light.id, polygon);
                    (light as any)._lastShadowPos = {x: light.x, y: light.y};
                }

                if (polygon.length > 0) {
                    lctx.beginPath();
                    lctx.moveTo(polygon[0].x - this.parent.cameraX, polygon[0].y - this.parent.cameraY);
                    for (let i = 1; i < polygon.length; i++) {
                        lctx.lineTo(polygon[i].x - this.parent.cameraX, polygon[i].y - this.parent.cameraY);
                    }
                    lctx.closePath();
                    lctx.clip();
                }

                const grad = lctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, light.radius);
                grad.addColorStop(0, light.color);
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                lctx.fillStyle = grad;
                lctx.fillRect(screenX - light.radius, screenY - light.radius, light.radius * 2, light.radius * 2);
                lctx.restore();
            });

            if (glowLights.length > 0) {
                lctx.save();
                lctx.globalCompositeOperation = 'screen';
                glowLights.forEach(light => {
                    const screenX = light.x - this.parent.cameraX;
                    const screenY = light.y - this.parent.cameraY;
                    if (screenX < -light.radius || screenX > w + light.radius || 
                        screenY < -light.radius || screenY > h + light.radius) return;

                    lctx.globalAlpha = light.intensity * (1.0 - ambientIntensity * 0.5);
                    const grad = lctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, light.radius);
                    grad.addColorStop(0, light.color);
                    grad.addColorStop(1, 'rgba(0,0,0,0)');
                    lctx.fillStyle = grad;
                    lctx.fillRect(screenX - light.radius, screenY - light.radius, light.radius * 2, light.radius * 2);
                });
                lctx.restore();
            }
        }

        this.meshVersion = worldMeshVersion;

        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(this.lightCanvas, 0, 0);
        ctx.restore();
    }

    private rebuildShadowChunk(chunk: any, gx: number, gy: number, sunDir: {x: number, y: number}, intensity: number): void {
        const sctx = chunk.ctx;
        sctx.clearRect(0, 0, this.chunkSize, this.chunkSize);
        if (intensity <= 0.1 || !this.parent.world) return;

        const worldX = gx * this.chunkSize;
        const worldY = gy * this.chunkSize;
        const segments = this.parent.world.getOcclusionSegments(worldX, worldY, this.chunkSize, this.chunkSize);
        
        sctx.save();
        sctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; 
        const shadowLen = 20 + 150 * (1.0 - Math.pow(intensity, 0.4)); 
        
        sctx.beginPath();
        segments.forEach(seg => {
            const a = { x: seg.a.x - worldX, y: seg.a.y - worldY };
            const b = { x: seg.b.x - worldX, y: seg.b.y - worldY };
            const a2 = { x: a.x + sunDir.x * shadowLen, y: a.y + sunDir.y * shadowLen };
            const b2 = { x: b.x + sunDir.x * shadowLen, y: b.y + sunDir.y * shadowLen };
            sctx.moveTo(a.x, a.y);
            sctx.lineTo(b.x, b.y);
            sctx.lineTo(b2.x, b2.y);
            sctx.lineTo(a2.x, a2.y);
            sctx.closePath();
        });
        sctx.fill();
        sctx.restore();
    }

    private rebuildMoonShadowChunk(chunk: any, gx: number, gy: number, moonDir: {x: number, y: number}, intensity: number, shadowLen: number): void {
        const sctx = chunk.ctx;
        sctx.clearRect(0, 0, this.chunkSize, this.chunkSize);
        // Intensity check lowered to ensure we see shadows at night
        if (intensity <= 0.05 || !this.parent.world) return;

        const worldX = gx * this.chunkSize;
        const worldY = gy * this.chunkSize;
        const segments = this.parent.world.getOcclusionSegments(worldX, worldY, this.chunkSize, this.chunkSize);
        
        sctx.save();
        // Moon shadows should be soft but visible
        sctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; 
        
        sctx.beginPath();
        segments.forEach(seg => {
            const a = { x: seg.a.x - worldX, y: seg.a.y - worldY };
            const b = { x: seg.b.x - worldX, y: seg.b.y - worldY };
            const a2 = { x: a.x + moonDir.x * shadowLen, y: a.y + moonDir.y * shadowLen };
            const b2 = { x: b.x + moonDir.x * shadowLen, y: b.y + moonDir.y * shadowLen };

            sctx.moveTo(a.x, a.y);
            sctx.lineTo(b.x, b.y);
            sctx.lineTo(b2.x, b2.y);
            sctx.lineTo(a2.x, a2.y);
            sctx.closePath();
        });
        sctx.fill();
        sctx.restore();
    }

    private renderEntityShadow(ctx: CanvasRenderingContext2D, e: Entity, sunDir: {x: number, y: number}, len: number): void {
        const ex = e.x - this.parent.cameraX;
        const ey = e.y - this.parent.cameraY;
        const r = e.radius;
        const angle = Math.atan2(sunDir.y, sunDir.x);
        const t1x = ex + Math.cos(angle - Math.PI/2) * r;
        const t1y = ey + Math.sin(angle - Math.PI/2) * r;
        const t2x = ex + Math.cos(angle + Math.PI/2) * r;
        const t2y = ey + Math.sin(angle + Math.PI/2) * r;
        const t3x = t2x + sunDir.x * len;
        const t3y = t2y + sunDir.y * len;
        const t4x = t1x + sunDir.x * len;
        const t4y = t1y + sunDir.y * len;

        ctx.beginPath();
        ctx.moveTo(t1x, t1y);
        ctx.lineTo(t2x, t2y);
        ctx.lineTo(t3x, t3y);
        ctx.lineTo(t4x, t4y);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex + sunDir.x * len, ey + sunDir.y * len, r, 0, Math.PI * 2);
        ctx.fill();
    }

    private renderVisionLight(lctx: CanvasRenderingContext2D): void {
        if (!this.parent.player || !this.parent.world) return;

        const { moonPhase } = WorldClock.getInstance().getTimeState();
        const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');
        
        // The "Reveal" color - desaturated pale blue-grey
        // Intensity of reveal scales slightly with moon phase, but always provides visibility
        const revealIntensity = 0.5 + (moonPhase * 0.3);
        const revealColor = `rgba(180, 200, 255, ${revealIntensity})`;

        const segRad = ConfigManager.getInstance().get<number>('Visuals', 'segmentVisibilityRadius') * tileSize;
        const coneDist = ConfigManager.getInstance().get<number>('Visuals', 'coneDistance') * tileSize;
        const coneAngleRad = (ConfigManager.getInstance().get<number>('Visuals', 'coneAngle') * Math.PI) / 180;

        // 1. Proximity reveal
        this.parent.player.getAllBodies().forEach(b => {
            const screenX = b.x - this.parent.cameraX;
            const screenY = b.y - this.parent.cameraY;
            const grad = lctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, segRad);
            grad.addColorStop(0, revealColor);
            grad.addColorStop(0.8, `rgba(100, 120, 180, ${revealIntensity * 0.5})`);
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            lctx.fillStyle = grad;
            lctx.beginPath();
            lctx.arc(screenX, screenY, segRad, 0, Math.PI * 2);
            lctx.fill();
        });

        // 2. Vision Cone reveal
        const playerScreenX = this.parent.player.x - this.parent.cameraX;
        const playerScreenY = this.parent.player.y - this.parent.cameraY;
        const startAngle = this.parent.player.rotation - coneAngleRad / 2;
        const rayCount = 60;
        
        lctx.save();
        lctx.beginPath();
        lctx.moveTo(playerScreenX, playerScreenY);
        for (let i = 0; i <= rayCount; i++) {
            const angle = startAngle + (i / rayCount) * coneAngleRad;
            const rayX = Math.cos(angle);
            const rayY = Math.sin(angle);
            let dist = 0;
            const step = tileSize / 2;
            while (dist < coneDist) {
                const testX = this.parent.player!.x + rayX * dist;
                const testY = this.parent.player!.y + rayY * dist;
                if (this.parent.world!.isWall(testX, testY)) break;
                dist += step;
            }
            lctx.lineTo(playerScreenX + rayX * dist, playerScreenY + rayY * dist);
        }
        lctx.closePath();
        lctx.clip();

        const coneGrad = lctx.createRadialGradient(playerScreenX, playerScreenY, 0, playerScreenX, playerScreenY, coneDist);
        coneGrad.addColorStop(0, revealColor);
        coneGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        lctx.fillStyle = coneGrad;
        lctx.fillRect(playerScreenX - coneDist, playerScreenY - coneDist, coneDist * 2, coneDist * 2);
        lctx.restore();
    }

    public clearCache(): void {
        this.shadowChunks.clear();
        this.lightPolygonCache.clear();
    }
}
