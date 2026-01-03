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
        
        const useFog = ConfigManager.getInstance().get<boolean>('Visuals', 'fogOfWar');
        if (useFog && this.parent.player) {
            this.renderFogOfWar(ctx);
        }
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
        lctx.fillStyle = sunColor;
        lctx.fillRect(0, 0, w, h);

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
            // Moon Entity Shadows
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

        // Dynamic Lights
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

        // Un-shadow casters
        lctx.save();
        lctx.globalCompositeOperation = 'source-over';
        lctx.translate(-this.parent.cameraX, -this.parent.cameraY);
        this.parent.world.renderAsSilhouette(lctx, this.parent.cameraX, this.parent.cameraY, '#ffffff');
        if (this.parent.player) this.parent.player.renderAsSilhouette(lctx, '#ffffff');
        this.parent.enemies.forEach(e => e.renderAsSilhouette(lctx, '#ffffff'));
        lctx.restore();

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
        if (intensity <= 0.1 || !this.parent.world) return;

        const worldX = gx * this.chunkSize;
        const worldY = gy * this.chunkSize;
        const segments = this.parent.world.getOcclusionSegments(worldX, worldY, this.chunkSize, this.chunkSize);
        
        sctx.save();
        // Moon shadow opacity scales with phase
        sctx.fillStyle = `rgba(0, 0, 0, ${0.6 * intensity})`; 
        
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

    private renderFogOfWar(mainCtx: CanvasRenderingContext2D): void {
        if (!this.fogCanvas || !this.fogCtx || !this.parent.player || !this.parent.world) return;

        const { ambientIntensity } = WorldClock.getInstance().getTimeState();
        let fogAlpha = (1.0 - (ambientIntensity - 0.05) / 0.75) * 0.85;
        if (ambientIntensity > 0.8) fogAlpha = 0;
        if (fogAlpha < 0) fogAlpha = 0;
        if (fogAlpha === 0) return;

        const w = mainCtx.canvas.width;
        const h = mainCtx.canvas.height;
        if (this.fogCanvas.width !== w || this.fogCanvas.height !== h) {
            this.fogCanvas.width = w; this.fogCanvas.height = h;
        }

        const fctx = this.fogCtx;
        const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');
        fctx.globalCompositeOperation = 'source-over';
        fctx.fillStyle = `rgba(0, 0, 0, ${fogAlpha})`;
        fctx.fillRect(0, 0, w, h);
        fctx.globalCompositeOperation = 'destination-out';
        
        const lights = LightManager.getInstance().getLights();
        lights.forEach(light => {
            const screenX = light.x - this.parent.cameraX;
            const screenY = light.y - this.parent.cameraY;
            if (screenX < -light.radius || screenX > w + light.radius || screenY < -light.radius || screenY > h + light.radius) return;
            const grad = fctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, light.radius);
            const alpha = Math.min(1.0, light.intensity * 0.8);
            grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            fctx.fillStyle = grad;
            fctx.beginPath();
            fctx.arc(screenX, screenY, light.radius, 0, Math.PI * 2);
            fctx.fill();
        });

        const segRad = ConfigManager.getInstance().get<number>('Visuals', 'segmentVisibilityRadius') * tileSize;
        const coneDist = ConfigManager.getInstance().get<number>('Visuals', 'coneDistance') * tileSize;
        const coneAngleRad = (ConfigManager.getInstance().get<number>('Visuals', 'coneAngle') * Math.PI) / 180;

        this.parent.player.getAllBodies().forEach(b => {
            const screenX = b.x - this.parent.cameraX;
            const screenY = b.y - this.parent.cameraY;
            const grad = fctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, segRad);
            grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
            grad.addColorStop(0.8, 'rgba(255, 255, 255, 0.8)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            fctx.fillStyle = grad;
            fctx.beginPath();
            fctx.arc(screenX, screenY, segRad, 0, Math.PI * 2);
            fctx.fill();
        });

        const playerScreenX = this.parent.player.x - this.parent.cameraX;
        const playerScreenY = this.parent.player.y - this.parent.cameraY;
        const startAngle = this.parent.player.rotation - coneAngleRad / 2;
        const rayCount = 60;
        
        fctx.beginPath();
        fctx.moveTo(playerScreenX, playerScreenY);
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
            fctx.lineTo(playerScreenX + rayX * dist, playerScreenY + rayY * dist);
        }
        fctx.closePath();
        const coneGrad = fctx.createRadialGradient(playerScreenX, playerScreenY, 0, playerScreenX, playerScreenY, coneDist);
        coneGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        coneGrad.addColorStop(1, 'rgba(255, 255, 255, 0.3)');
        fctx.fillStyle = coneGrad;
        fctx.fill();

        mainCtx.drawImage(this.fogCanvas, 0, 0);
    }

    public clearCache(): void {
        this.shadowChunks.clear();
        this.lightPolygonCache.clear();
    }
}
