import { World } from '../World';
import { Player } from '../../entities/Player';
import { Enemy } from '../../entities/Enemy';
import { Projectile } from '../../entities/Projectile';
import { Entity } from '../Entity';
import { WorldClock } from '../WorldClock';
import { LightManager } from '../LightManager';
import { VisibilitySystem, Point } from '../VisibilitySystem';
import { ConfigManager } from '../../config/MasterConfig';

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
    // Buffers for additive lighting pipeline
    private lightCanvas: HTMLCanvasElement;
    private lightCtx: CanvasRenderingContext2D;
    private maskCanvas: HTMLCanvasElement;
    private maskCtx: CanvasRenderingContext2D;
    private sourceCanvas: HTMLCanvasElement;
    private sourceCtx: CanvasRenderingContext2D;
    
    private shadowChunks: Map<string, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, version: string }> = new Map();
    private chunkSize: number = 512;
    private lightPolygonCache: Map<string, Point[]> = new Map();
    private meshVersion: number = 0;

    constructor(private parent: LightingParent) {
        this.lightCanvas = document.createElement('canvas');
        this.lightCtx = this.lightCanvas.getContext('2d', { willReadFrequently: true })!;
        this.maskCanvas = document.createElement('canvas');
        this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true })!;
        this.sourceCanvas = document.createElement('canvas');
        this.sourceCtx = this.sourceCanvas.getContext('2d', { willReadFrequently: true })!;
    }

    public render(ctx: CanvasRenderingContext2D): void {
        this.renderLighting(ctx);
    }

    private renderLighting(ctx: CanvasRenderingContext2D): void {
        const lightingEnabled = ConfigManager.getInstance().get<boolean>('Lighting', 'enabled');
        if (!lightingEnabled || !this.parent.world) return;

        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        
        if (this.lightCanvas.width !== w || this.lightCanvas.height !== h) {
            this.lightCanvas.width = w; this.lightCanvas.height = h;
            this.maskCanvas.width = w; this.maskCanvas.height = h;
            this.sourceCanvas.width = w; this.sourceCanvas.height = h;
        }

        const { sun, moon, baseAmbient, isDaylight } = WorldClock.getInstance().getTimeState();
        const worldMeshVersion = this.parent.world.getMeshVersion();
        const lctx = this.lightCtx;

        // 1. BASE FLOOR
        lctx.globalCompositeOperation = 'source-over'; 
        lctx.fillStyle = baseAmbient;
        lctx.fillRect(0, 0, w, h);

        // 2. SUN/MOON (Additive)
        if (sun.active) this.renderDirectionalLight(lctx, sun, 'sun', worldMeshVersion, w, h);
        if (moon.active) this.renderDirectionalLight(lctx, moon, 'moon', worldMeshVersion, w, h);

        // 3. ENTITY AMBIENT REVEAL
        lctx.save();
        lctx.globalCompositeOperation = 'screen'; 
        lctx.translate(-this.parent.cameraX, -this.parent.cameraY);
        const silColor = isDaylight ? 'rgb(60, 60, 60)' : 'rgb(30, 35, 50)';
        this.parent.world.renderAsSilhouette(lctx, this.parent.cameraX, this.parent.cameraY, silColor);
        if (this.parent.player) this.parent.player.renderAsSilhouette(lctx, silColor);
        this.parent.enemies.forEach(e => e.renderAsSilhouette(lctx, silColor));
        lctx.restore();

        // 4. VISION
        if (this.parent.player) {
            lctx.save();
            lctx.globalCompositeOperation = 'screen';
            this.renderVisionLight(lctx);
            lctx.restore();
        }

        // 5. POINT LIGHTS
        const activeIntensity = isDaylight ? sun.intensity : moon.intensity;
        if (activeIntensity < 0.95) {
            this.renderPointLights(lctx, activeIntensity, worldMeshVersion, w, h);
        }

        this.meshVersion = worldMeshVersion;

        // 6. APPLY TO WORLD
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(this.lightCanvas, 0, 0);
        ctx.restore();
    }

    private renderDirectionalLight(targetCtx: CanvasRenderingContext2D, source: any, type: string, worldVersion: number, w: number, h: number): void {
        const sctx = this.sourceCtx;
        sctx.globalCompositeOperation = 'source-over';
        sctx.fillStyle = source.color;
        sctx.fillRect(0, 0, w, h);

        const mctx = this.maskCtx;
        mctx.globalCompositeOperation = 'source-over';
        mctx.clearRect(0, 0, w, h);
        mctx.fillStyle = '#000000'; // Solid mask for unification

        const angle = Math.atan2(source.direction.y, source.direction.x);
        const bakeVersion = `${worldVersion}_${Math.round(angle * 100)}_${type}`;

        const startGX = Math.floor(this.parent.cameraX / this.chunkSize);
        const startGY = Math.floor(this.parent.cameraY / this.chunkSize);
        const endGX = Math.floor((this.parent.cameraX + w) / this.chunkSize);
        const endGY = Math.floor((this.parent.cameraY + h) / this.chunkSize);

        // Draw solid shadows into mask
        for (let gy = startGY; gy <= endGY; gy++) {
            for (let gx = startGX; gx <= endGX; gx++) {
                const key = `${gx},${gy}_${type}`;
                let chunk = this.shadowChunks.get(key);
                if (!chunk) {
                    const canvas = document.createElement('canvas');
                    canvas.width = this.chunkSize;
                    canvas.height = this.chunkSize;
                    chunk = { canvas, ctx: canvas.getContext('2d')!, version: '' };
                    this.shadowChunks.set(key, chunk);
                }
                if (chunk.version !== bakeVersion) {
                    this.rebuildShadowChunk(chunk, gx, gy, source);
                    chunk.version = bakeVersion;
                }
                mctx.drawImage(chunk.canvas, gx * this.chunkSize - this.parent.cameraX, gy * this.chunkSize - this.parent.cameraY);
            }
        }

        // Entities
        const entities = [];
        if (this.parent.player) {
            entities.push(this.parent.player);
            entities.push(...this.parent.player.segments);
        }
        entities.push(...this.parent.enemies);
        entities.forEach(e => {
            if (e.active) this.renderEntityShadow(mctx, e, source.direction, source.shadowLen);
        });

        // REVEAL OBJECTS (The critical fix for "Shadows on top")
        // We erase the footprint of the walls from the shadow mask
        mctx.save();
        mctx.globalCompositeOperation = 'destination-out';
        mctx.translate(-this.parent.cameraX, -this.parent.cameraY);
        // Silhouette representing full 3D object height
        this.parent.world!.renderAsSilhouette(mctx, this.parent.cameraX, this.parent.cameraY, '#ffffff');
        if (this.parent.player) this.parent.player.renderAsSilhouette(mctx, '#ffffff');
        this.parent.enemies.forEach(e => e.renderAsSilhouette(mctx, '#ffffff'));
        mctx.restore();

        // Apply mask to light source
        sctx.globalCompositeOperation = 'destination-out';
        sctx.drawImage(this.maskCanvas, 0, 0);

        // Add to main map
        targetCtx.save();
        targetCtx.globalCompositeOperation = 'screen';
        targetCtx.globalAlpha = source.intensity;
        targetCtx.drawImage(this.sourceCanvas, 0, 0);
        targetCtx.restore();
    }

    private rebuildShadowChunk(chunk: any, gx: number, gy: number, source: any): void {
        const sctx = chunk.ctx;
        sctx.clearRect(0, 0, this.chunkSize, this.chunkSize);
        
        const worldX = gx * this.chunkSize;
        const worldY = gy * this.chunkSize;
        const padding = 300; 
        const segments = this.parent.world!.getOcclusionSegments(worldX - padding, worldY - padding, this.chunkSize + padding * 2, this.chunkSize + padding * 2);
        
        sctx.fillStyle = '#000000';
        const dx = source.direction.x * source.shadowLen;
        const dy = source.direction.y * source.shadowLen;
        const wallHeight = 8; // Offset from ground to roof

        segments.forEach(seg => {
            // Shadow volume connects Ground(A,B) to ProjectedRoof(A,B)
            // This ensures base width matches wall width perfectly
            const groundA = seg.a;
            const groundB = seg.b;
            const roofA = { x: groundA.x, y: groundA.y - wallHeight };
            const roofB = { x: groundB.x, y: groundB.y - wallHeight };
            
            const projA = { x: roofA.x + dx, y: roofA.y + dy };
            const projB = { x: roofB.x + dx, y: roofB.y + dy };

            sctx.beginPath();
            sctx.moveTo(groundA.x - worldX, groundA.y - worldY);
            sctx.lineTo(groundB.x - worldX, groundB.y - worldY);
            sctx.lineTo(projB.x - worldX, projB.y - worldY);
            sctx.lineTo(projA.x - worldX, projA.y - worldY);
            sctx.closePath();
            sctx.fill();
        });
    }

    private renderEntityShadow(ctx: CanvasRenderingContext2D, e: Entity, dir: {x: number, y: number}, len: number): void {
        const ex = e.x - this.parent.cameraX;
        const ey = e.y - this.parent.cameraY;
        const r = e.radius;
        const angle = Math.atan2(dir.y, dir.x);
        
        // Entity shadow anchored to center
        const t1x = ex + Math.cos(angle - Math.PI/2) * r;
        const t1y = ey + Math.sin(angle - Math.PI/2) * r;
        const t2x = ex + Math.cos(angle + Math.PI/2) * r;
        const t2y = ey + Math.sin(angle + Math.PI/2) * r;
        const t3x = t2x + dir.x * len;
        const t3y = t2y + dir.y * len;
        const t4x = t1x + dir.x * len;
        const t4y = t1y + dir.y * len;

        ctx.beginPath();
        ctx.moveTo(t1x, t1y);
        ctx.lineTo(t2x, t2y);
        ctx.lineTo(t3x, t3y);
        ctx.lineTo(t4x, t4y);
        ctx.closePath();
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(ex + dir.x * len, ey + dir.y * len, r, 0, Math.PI * 2);
        ctx.fill();
    }

    private renderPointLights(lctx: CanvasRenderingContext2D, ambientIntensity: number, meshVersion: number, w: number, h: number): void {
        const lights = LightManager.getInstance().getLights();
        const segments = this.parent.world!.getOcclusionSegments(this.parent.cameraX, this.parent.cameraY, w, h);
        lctx.save();
        lctx.globalCompositeOperation = 'screen';
        
        lights.forEach(light => {
            const screenX = light.x - this.parent.cameraX;
            const screenY = light.y - this.parent.cameraY;
            if (screenX < -light.radius || screenX > w + light.radius || screenY < -light.radius || screenY > h + light.radius) return;

            lctx.save();
            lctx.globalAlpha = light.intensity * (1.0 - ambientIntensity * 0.5);

            if (light.castsShadows) {
                let polygon = this.lightPolygonCache.get(light.id);
                const lastPos = (light as any)._lastShadowPos || {x: 0, y: 0};
                if (!polygon || meshVersion !== this.meshVersion || Math.abs(light.x - lastPos.x) > 2 || Math.abs(light.y - lastPos.y) > 2) {
                    polygon = VisibilitySystem.calculateVisibility({x: light.x, y: light.y}, segments);
                    this.lightPolygonCache.set(light.id, polygon);
                    (light as any)._lastShadowPos = {x: light.x, y: light.y};
                }
                if (polygon.length > 0) {
                    lctx.beginPath();
                    lctx.moveTo(polygon[0].x - this.parent.cameraX, polygon[0].y - this.parent.cameraY);
                    for (let i = 1; i < polygon.length; i++) lctx.lineTo(polygon[i].x - this.parent.cameraX, polygon[i].y - this.parent.cameraY);
                    lctx.closePath();
                    lctx.clip();
                }
            }

            const grad = lctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, light.radius);
            grad.addColorStop(0, light.color);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            lctx.fillStyle = grad;
            lctx.fillRect(screenX - light.radius, screenY - light.radius, light.radius * 2, light.radius * 2);
            lctx.restore();
        });
        lctx.restore();
    }

    private renderVisionLight(lctx: CanvasRenderingContext2D): void {
        if (!this.parent.player || !this.parent.world) return;
        const { moonPhase } = WorldClock.getInstance().getTimeState();
        const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');
        const revealIntensity = 0.5 + (moonPhase * 0.3);
        const revealColor = `rgba(180, 200, 255, ${revealIntensity})`;

        const segRad = ConfigManager.getInstance().get<number>('Visuals', 'segmentVisibilityRadius') * tileSize;
        const coneDist = ConfigManager.getInstance().get<number>('Visuals', 'coneDistance') * tileSize;
        const coneAngleRad = (ConfigManager.getInstance().get<number>('Visuals', 'coneAngle') * Math.PI) / 180;

        this.parent.player.getAllBodies().forEach(b => {
            const screenX = b.x - this.parent.cameraX;
            const screenY = b.y - this.parent.cameraY;
            const grad = lctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, segRad);
            grad.addColorStop(0, revealColor);
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            lctx.fillStyle = grad;
            lctx.beginPath();
            lctx.arc(screenX, screenY, segRad, 0, Math.PI * 2);
            lctx.fill();
        });

        const playerScreenX = this.parent.player.x - this.parent.cameraX;
        const playerScreenY = this.parent.player.y - this.parent.cameraY;
        const startAngle = this.parent.player.rotation - coneAngleRad / 2;
        
        lctx.save();
        lctx.beginPath();
        lctx.moveTo(playerScreenX, playerScreenY);
        for (let i = 0; i <= 60; i++) {
            const angle = startAngle + (i / 60) * coneAngleRad;
            const rayX = Math.cos(angle);
            const rayY = Math.sin(angle);
            let dist = 0;
            while (dist < coneDist) {
                if (this.parent.world!.isWall(this.parent.player!.x + rayX * dist, this.parent.player!.y + rayY * dist)) break;
                dist += 16;
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