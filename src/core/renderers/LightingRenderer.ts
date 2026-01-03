import { World } from '../World';
import { Player } from '../../entities/Player';
import { Enemy } from '../../entities/Enemy';
import { Projectile } from '../../entities/Projectile';
import { Entity } from '../Entity';
import { WorldClock } from '../WorldClock';
import { LightManager } from '../LightManager';
import { VisibilitySystem, Point } from '../VisibilitySystem';
import { ConfigManager } from '../../config/MasterConfig';
import { WeatherManager, WeatherType, CloudType } from '../WeatherManager';

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

    // Weather Visuals
    private cloudCanvas: HTMLCanvasElement;
    private cloudCtx: CanvasRenderingContext2D;
    private fogCanvas: HTMLCanvasElement;
    private fogCtx: CanvasRenderingContext2D;
    private fogNoise: HTMLCanvasElement | null = null;
    private fogOffset: { x: number, y: number } = { x: 0, y: 0 };
    private cloudOffset: { x: number, y: number } = { x: 0, y: 0 };
    private cloudShapes: HTMLCanvasElement[] = [];
    private particles: { x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number }[] = [];
    private splashes: { x: number, y: number, life: number, type: 'rain' | 'snow' }[] = [];
    private lastParticleUpdate: number = 0;

    constructor(private parent: LightingParent) {
        this.lightCanvas = document.createElement('canvas');
        this.lightCtx = this.lightCanvas.getContext('2d', { willReadFrequently: true })!;
        this.maskCanvas = document.createElement('canvas');
        this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true })!;
        this.sourceCanvas = document.createElement('canvas');
        this.sourceCtx = this.sourceCanvas.getContext('2d', { willReadFrequently: true })!;

        this.cloudCanvas = document.createElement('canvas');
        this.cloudCtx = this.cloudCanvas.getContext('2d')!;
        this.fogCanvas = document.createElement('canvas');
        this.fogCtx = this.fogCanvas.getContext('2d')!;
        
        this.generateCloudShapes();
        this.generateFogNoise();
        this.initParticles();
    }

    private generateFogNoise(): void {
        this.fogNoise = document.createElement('canvas');
        const size = 512;
        this.fogNoise.width = size;
        this.fogNoise.height = size;
        const ctx = this.fogNoise.getContext('2d')!;
        
        // Wraparound Procedural Noise
        for (let i = 0; i < 30; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 60 + Math.random() * 100;
            
            // Draw circle with 9-tap wraparound to ensure seamless tiling
            const offsets = [
                {ox: 0, oy: 0}, {ox: size, oy: 0}, {ox: -size, oy: 0},
                {ox: 0, oy: size}, {ox: 0, oy: -size},
                {ox: size, oy: size}, {ox: size, oy: -size},
                {ox: -size, oy: size}, {ox: -size, oy: -size}
            ];

            offsets.forEach(off => {
                const grad = ctx.createRadialGradient(x + off.ox, y + off.oy, 0, x + off.ox, y + off.oy, r);
                grad.addColorStop(0, 'rgba(255,255,255,0.4)');
                grad.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = grad;
                ctx.beginPath(); 
                ctx.arc(x + off.ox, y + off.oy, r, 0, Math.PI * 2); 
                ctx.fill();
            });
        }
    }

    private generateCloudShapes(): void {
        for (let i = 0; i < 8; i++) {
            const canvas = document.createElement('canvas');
            canvas.width = 512; canvas.height = 512;
            const ctx = canvas.getContext('2d')!;
            
            // Draw a cluster of soft circles, constrained to center to ensure 0 alpha at edges
            ctx.fillStyle = '#000000';
            for (let j = 0; j < 10; j++) {
                const x = 256 + (Math.random() - 0.5) * 200;
                const y = 256 + (Math.random() - 0.5) * 200;
                const r = 80 + Math.random() * 120;
                const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
                grad.addColorStop(0, 'rgba(0,0,0,0.8)');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            }
            this.cloudShapes.push(canvas);
        }
    }

    private initParticles(): void {
        for (let i = 0; i < 1000; i++) {
            this.particles.push({
                x: Math.random() * 2000,
                y: Math.random() * 2000,
                z: Math.random() * 500,
                vx: 0, vy: 0, vz: 0,
                life: Math.random()
            });
        }
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
        const weather = WeatherManager.getInstance().getWeatherState();

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

        // 6. CLOUD SHADOWS (Still in lightmap)
        if (weather.cloudType !== CloudType.NONE) {
            this.renderCloudShadows(lctx, weather, w, h);
        }

        this.meshVersion = worldMeshVersion;

        // 7. APPLY LIGHTMAP TO WORLD
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(this.lightCanvas, 0, 0);
        ctx.restore();

        // 8. POST-LIGHTING OVERLAYS (Fog & Particles)
        if (weather.fogDensity > 0.05) {
            this.renderFogOverlay(ctx, weather, w, h);
        }
        this.renderParticles(ctx);
    }

    private renderFogOverlay(ctx: CanvasRenderingContext2D, weather: any, w: number, h: number): void {
        const { isDaylight } = WorldClock.getInstance().getTimeState();
        
        // Update fog offset based on wind
        const dt = 1/60; 
        this.fogOffset.x += weather.windDir.x * weather.windSpeed * 10 * dt;
        this.fogOffset.y += weather.windDir.y * weather.windSpeed * 10 * dt;

        ctx.save();
        
        // DAYTIME WASHOUT: Use screen to brighten/haze the world
        if (isDaylight) {
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = weather.fogDensity * 0.4;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = weather.fogDensity * 0.3;
        }

        const fogColor = weather.type === WeatherType.SNOW ? '220, 230, 255' : '180, 185, 200';
        
        // Render noise-based banks
        if (this.fogNoise) {
            const spacing = 512;
            const startX = Math.floor((this.parent.cameraX + this.fogOffset.x) / spacing) * spacing - (this.parent.cameraX + this.fogOffset.x);
            const startY = Math.floor((this.parent.cameraY + this.fogOffset.y) / spacing) * spacing - (this.parent.cameraY + this.fogOffset.y);

            for (let ox = startX; ox < w + spacing; ox += spacing) {
                for (let oy = startY; oy < h + spacing; oy += spacing) {
                    ctx.drawImage(this.fogNoise, ox, oy, spacing, spacing);
                }
            }
        }

        // Global base fog haze
        ctx.fillStyle = `rgb(${fogColor})`;
        ctx.globalAlpha *= 0.6;
        ctx.fillRect(0, 0, w, h);
        
        ctx.restore();
    }

    private renderCloudShadows(lctx: CanvasRenderingContext2D, weather: any, w: number, h: number): void {
        // Update cloud offset based on wind
        const dt = 1/60; 
        this.cloudOffset.x += weather.windDir.x * weather.windSpeed * 20 * dt;
        this.cloudOffset.y += weather.windDir.y * weather.windSpeed * 20 * dt;

        lctx.save();
        lctx.globalCompositeOperation = 'multiply';
        // Much more subtle shadows. Clouds shouldn't be pitch black.
        lctx.globalAlpha = 0.15 + (weather.cloudType === CloudType.OVERCAST ? 0.15 : 0);

        const spacing = 1024;
        const startX = Math.floor((this.parent.cameraX + this.cloudOffset.x) / spacing) * spacing - (this.parent.cameraX + this.cloudOffset.x);
        const startY = Math.floor((this.parent.cameraY + this.cloudOffset.y) / spacing) * spacing - (this.parent.cameraY + this.cloudOffset.y);

        for (let ox = startX; ox < w + spacing; ox += spacing) {
            for (let oy = startY; oy < h + spacing; oy += spacing) {
                const seed = Math.floor((ox + this.parent.cameraX + this.cloudOffset.x) / spacing) + 
                             Math.floor((oy + this.parent.cameraY + this.cloudOffset.y) / spacing) * 100;
                const shapeIdx = Math.abs(seed) % this.cloudShapes.length;
                lctx.drawImage(this.cloudShapes[shapeIdx], ox, oy, spacing, spacing);
            }
        }
        lctx.restore();
    }

    private renderParticles(ctx: CanvasRenderingContext2D): void {
        const weather = WeatherManager.getInstance().getWeatherState();
        if (weather.precipitationIntensity < 0.05 && this.splashes.length === 0) return;

        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        const now = performance.now();
        const dt = this.lastParticleUpdate ? (now - this.lastParticleUpdate) / 1000 : 0.016;
        this.lastParticleUpdate = now;

        // Camera movement delta for parallax
        const camDx = (this.parent.cameraX - (this as any)._lastCamX || 0);
        const camDy = (this.parent.cameraY - (this as any)._lastCamY || 0);
        (this as any)._lastCamX = this.parent.cameraX;
        (this as any)._lastCamY = this.parent.cameraY;

        ctx.save();
        
        // 1. RENDER SPLASHES (On Ground)
        this.splashes = this.splashes.filter(s => s.life > 0);
        this.splashes.forEach(s => {
            s.life -= dt * 4;
            const sx = s.x - this.parent.cameraX;
            const sy = s.y - this.parent.cameraY;
            
            if (s.type === 'rain') {
                ctx.strokeStyle = `rgba(180, 200, 255, ${s.life * 0.4})`;
                ctx.beginPath();
                ctx.ellipse(sx, sy, (1 - s.life) * 15, (1 - s.life) * 8, 0, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                ctx.fillStyle = `rgba(255, 255, 255, ${s.life * 0.6})`;
                ctx.beginPath();
                ctx.arc(sx, sy, (1 - s.life) * 4, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // 2. RENDER FALLING PARTICLES
        if (weather.precipitationIntensity > 0.05) {
            if (weather.type === WeatherType.RAIN) {
                ctx.strokeStyle = 'rgba(160, 190, 255, 0.4)';
                ctx.lineWidth = 1;
                this.particles.forEach(p => {
                    // Vertical fall + Wind
                    p.vz = -500; // Falling "down" in Z
                    p.vx = weather.windDir.x * weather.windSpeed * 50;
                    p.vy = weather.windDir.y * weather.windSpeed * 50;

                    // Apply motion + Camera Parallax (higher particles move more with camera)
                    const parallaxMult = p.z / 500;
                    p.x += (p.vx - camDx * parallaxMult) * dt;
                    p.y += (p.vy - camDy * parallaxMult) * dt;
                    p.z += p.vz * dt;

                    // Screen Wrap
                    const sx = p.x % w;
                    const sy = p.y % h;
                    const screenX = sx < 0 ? sx + w : sx;
                    const screenY = sy < 0 ? sy + h : sy;

                    // Impact ground
                    if (p.z <= 0) {
                        if (Math.random() < 0.2) { // Cap splashes for performance
                            this.splashes.push({ 
                                x: screenX + this.parent.cameraX, 
                                y: screenY + this.parent.cameraY, 
                                life: 1.0, 
                                type: 'rain' 
                            });
                        }
                        p.z = 400 + Math.random() * 200;
                    }

                    ctx.beginPath();
                    ctx.moveTo(screenX, screenY - p.z * 0.2);
                    ctx.lineTo(screenX + p.vx * 0.01, (screenY - p.z * 0.2) + 10);
                    ctx.stroke();
                });
            } else if (weather.type === WeatherType.SNOW) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                this.particles.forEach(p => {
                    p.vz = -80 - Math.random() * 40;
                    const sway = Math.sin(now * 0.002 + p.life * 10) * 30;
                    p.vx = weather.windDir.x * weather.windSpeed * 30 + sway;
                    p.vy = weather.windDir.y * weather.windSpeed * 30;

                    const parallaxMult = p.z / 500;
                    p.x += (p.vx - camDx * parallaxMult) * dt;
                    p.y += (p.vy - camDy * parallaxMult) * dt;
                    p.z += p.vz * dt;

                    const sx = p.x % w;
                    const sy = p.y % h;
                    const screenX = sx < 0 ? sx + w : sx;
                    const screenY = sy < 0 ? sy + h : sy;

                    if (p.z <= 0) {
                        if (Math.random() < 0.1) {
                            this.splashes.push({ 
                                x: screenX + this.parent.cameraX, 
                                y: screenY + this.parent.cameraY, 
                                life: 1.0, 
                                type: 'snow' 
                            });
                        }
                        p.z = 400 + Math.random() * 200;
                    }

                    ctx.beginPath();
                    ctx.arc(screenX, screenY - p.z * 0.2, 1 + Math.random() * 2, 0, Math.PI * 2);
                    ctx.fill();
                });
            }
        }
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

            // FOG SCATTER HALO (Larger, soft glow around lights in fog)
            const weather = WeatherManager.getInstance().getWeatherState();
            if (weather.fogDensity > 0.1) {
                lctx.save();
                lctx.globalCompositeOperation = 'screen';
                const haloRadius = light.radius * (1.5 + weather.fogDensity * 2.0);
                const haloAlpha = light.intensity * weather.fogDensity * 0.4;
                lctx.globalAlpha = haloAlpha;

                const haloGrad = lctx.createRadialGradient(screenX, screenY, light.radius * 0.2, screenX, screenY, haloRadius);
                haloGrad.addColorStop(0, light.color);
                haloGrad.addColorStop(1, 'rgba(0,0,0,0)');
                lctx.fillStyle = haloGrad;
                lctx.fillRect(screenX - haloRadius, screenY - haloRadius, haloRadius * 2, haloRadius * 2);
                lctx.restore();
            }
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

        // FOG CONE SCATTER
        const weather = WeatherManager.getInstance().getWeatherState();
        if (weather.fogDensity > 0.1) {
            lctx.save();
            lctx.globalCompositeOperation = 'screen';
            lctx.globalAlpha = weather.fogDensity * 0.25;
            
            // Draw the same cone but without world occlusion clipping, 
            // and slightly larger/softer to simulate light scattering in air
            lctx.beginPath();
            lctx.moveTo(playerScreenX, playerScreenY);
            const startAngleScatter = this.parent.player.rotation - (coneAngleRad * 1.2) / 2;
            for (let i = 0; i <= 30; i++) {
                const angle = startAngleScatter + (i / 30) * (coneAngleRad * 1.2);
                lctx.lineTo(playerScreenX + Math.cos(angle) * coneDist * 0.8, playerScreenY + Math.sin(angle) * coneDist * 0.8);
            }
            lctx.closePath();
            
            const scatterGrad = lctx.createRadialGradient(playerScreenX, playerScreenY, 0, playerScreenX, playerScreenY, coneDist);
            scatterGrad.addColorStop(0, revealColor);
            scatterGrad.addColorStop(1, 'rgba(0,0,0,0)');
            lctx.fillStyle = scatterGrad;
            lctx.fill();
            lctx.restore();
        }
    }

    public clearCache(): void {
        this.shadowChunks.clear();
        this.lightPolygonCache.clear();
    }
}