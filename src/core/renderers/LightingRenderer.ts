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
import { ParticleSystem } from '../ParticleSystem';

export interface LightingParent {
    world: World | null;
    player: Player | null;
    enemies: Enemy[];
    projectiles: Projectile[];
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
    private tempCanvas: HTMLCanvasElement;
    private tempCtx: CanvasRenderingContext2D;
    
    private shadowChunks: Map<string, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, version: string }> = new Map();
    private silhouetteChunks: Map<string, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, version: number }> = new Map();
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
        this.tempCanvas = document.createElement('canvas');
        this.tempCtx = this.tempCanvas.getContext('2d')!;

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
        for (let i = 0; i < 12; i++) { // Increased variety
            const canvas = document.createElement('canvas');
            canvas.width = 512; canvas.height = 512;
            const ctx = canvas.getContext('2d')!;
            
            // Multiple blobs for organic feel
            const blobs = 3 + Math.floor(Math.random() * 5);
            for (let j = 0; j < blobs; j++) {
                const x = 256 + (Math.random() - 0.5) * 180;
                const y = 256 + (Math.random() - 0.5) * 180;
                const r = 100 + Math.random() * 100;
                
                const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
                const opacity = 0.6 + Math.random() * 0.4;
                grad.addColorStop(0, `rgba(0,0,0,${opacity})`);
                grad.addColorStop(0.5, `rgba(0,0,0,${opacity * 0.5})`);
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

    private drawWorldSilhouette(targetCtx: CanvasRenderingContext2D, color: string | null, meshVersion: number, w: number, h: number): void {
        const tctx = this.tempCtx;
        tctx.clearRect(0, 0, w, h);
        
        const startGX = Math.floor(this.parent.cameraX / this.chunkSize);
        const startGY = Math.floor(this.parent.cameraY / this.chunkSize);
        const endGX = Math.floor((this.parent.cameraX + w) / this.chunkSize);
        const endGY = Math.floor((this.parent.cameraY + h) / this.chunkSize);

        for (let gy = startGY; gy <= endGY; gy++) {
            for (let gx = startGX; gx <= endGX; gx++) {
                const key = `${gx},${gy}`;
                let chunk = this.silhouetteChunks.get(key);
                if (!chunk) {
                    const canvas = document.createElement('canvas');
                    canvas.width = this.chunkSize;
                    canvas.height = this.chunkSize;
                    chunk = { canvas, ctx: canvas.getContext('2d')!, version: -1 };
                    this.silhouetteChunks.set(key, chunk);
                }
                if (chunk.version !== meshVersion) {
                    this.rebuildSilhouetteChunk(chunk, gx, gy);
                    chunk.version = meshVersion;
                }
                tctx.drawImage(chunk.canvas, gx * this.chunkSize - this.parent.cameraX, gy * this.chunkSize - this.parent.cameraY);
            }
        }

        if (color) {
            tctx.globalCompositeOperation = 'source-in';
            tctx.fillStyle = color;
            tctx.fillRect(0, 0, w, h);
            tctx.globalCompositeOperation = 'source-over';
        }
        
        targetCtx.drawImage(this.tempCanvas, 0, 0);
    }

    private rebuildSilhouetteChunk(chunk: any, gx: number, gy: number): void {
        const ctx = chunk.ctx;
        ctx.clearRect(0, 0, this.chunkSize, this.chunkSize);
        const worldX = gx * this.chunkSize;
        const worldY = gy * this.chunkSize;
        
        if (this.parent.world) {
            this.parent.world.renderAsSilhouette(ctx, worldX, worldY, '#ffffff');
        }
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
            this.tempCanvas.width = w; this.tempCanvas.height = h;
            this.fogCanvas.width = w; this.fogCanvas.height = h;
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
        // Slightly warmer silhouette during day
        const silColor = isDaylight ? 'rgb(70, 65, 60)' : 'rgb(30, 35, 50)';
        this.drawWorldSilhouette(lctx, silColor, worldMeshVersion, w, h);
        
        lctx.translate(-this.parent.cameraX, -this.parent.cameraY);
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
        // Always render point lights, but they are naturally washed out by high sun intensity
        this.renderPointLights(lctx, activeIntensity, worldMeshVersion, w, h);

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
        const { sun, moon, isDaylight } = WorldClock.getInstance().getTimeState();
        const fctx = this.fogCtx;
        
        fctx.clearRect(0, 0, w, h);
        
        // Calculate dynamic fog color based on global light level
        // During night, fog color scales with moonlight
        const lightIntensity = isDaylight ? sun.intensity : Math.max(moon.intensity, 0.02);
        const baseFogRGB = weather.type === WeatherType.SNOW ? [210, 225, 255] : [160, 170, 190];
        
        const r = Math.floor(baseFogRGB[0] * lightIntensity);
        const g = Math.floor(baseFogRGB[1] * lightIntensity);
        const b = Math.floor(baseFogRGB[2] * lightIntensity);
        const fogColor = `rgb(${r}, ${g}, ${b})`;

        // Update fog offset based on wind
        const dt = 1/60; 
        this.fogOffset.x += weather.windDir.x * weather.windSpeed * 10 * dt;
        this.fogOffset.y += weather.windDir.y * weather.windSpeed * 10 * dt;

        // 1. Render noise to fog buffer
        if (this.fogNoise) {
            const spacing = 512;
            const startX = Math.floor((this.parent.cameraX + this.fogOffset.x) / spacing) * spacing - (this.parent.cameraX + this.fogOffset.x);
            const startY = Math.floor((this.parent.cameraY + this.fogOffset.y) / spacing) * spacing - (this.parent.cameraY + this.fogOffset.y);

            fctx.save();
            for (let ox = startX; ox < w + spacing; ox += spacing) {
                for (let oy = startY; oy < h + spacing; oy += spacing) {
                    fctx.drawImage(this.fogNoise, ox, oy, spacing, spacing);
                }
            }
            fctx.restore();
        }

        // 2. Color the noise in the buffer
        fctx.save();
        fctx.globalCompositeOperation = 'source-in';
        fctx.fillStyle = fogColor;
        fctx.fillRect(0, 0, w, h);
        fctx.restore();

        // 3. Add base haze layer to the buffer
        fctx.save();
        fctx.globalCompositeOperation = 'destination-over';
        fctx.fillStyle = fogColor;
        fctx.globalAlpha = 0.5;
        fctx.fillRect(0, 0, w, h);
        fctx.restore();

        // 4. Draw fog buffer to main context
        ctx.save();
        if (isDaylight) {
            // Day: Screen adds light to simulate scattering
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = weather.fogDensity * 0.5;
        } else {
            // Night: Source-over obscures/darkens the world based on light level
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = weather.fogDensity * 0.7;
        }
        ctx.drawImage(this.fogCanvas, 0, 0);
        ctx.restore();
    }

    private renderCloudShadows(lctx: CanvasRenderingContext2D, weather: any, w: number, h: number): void {
        // Update cloud offset based on independent cloud wind
        const dt = 1/60; 
        this.cloudOffset.x += weather.cloudWindDir.x * weather.cloudWindSpeed * 15 * dt;
        this.cloudOffset.y += weather.cloudWindDir.y * weather.cloudWindSpeed * 15 * dt;

        lctx.save();
        lctx.globalCompositeOperation = 'multiply';

        // 1. If OVERCAST (100% coverage), just apply a global dimming to the lightmap
        if (weather.cloudType === CloudType.OVERCAST) {
            lctx.fillStyle = 'rgba(120, 130, 150, 0.5)'; // Cool grey tint
            lctx.fillRect(0, 0, w, h);
            lctx.restore();
            return;
        }

        // 2. If SCATTERED/BROKEN, render individual distinct cloud shadows
        // More dramatic shadows for visibility
        lctx.globalAlpha = 0.4; 

        const spacing = 400; 
        const startX = Math.floor((this.parent.cameraX + this.cloudOffset.x) / spacing) * spacing - (this.parent.cameraX + this.cloudOffset.x);
        const startY = Math.floor((this.parent.cameraY + this.cloudOffset.y) / spacing) * spacing - (this.parent.cameraY + this.cloudOffset.y);

        for (let ox = startX; ox < w + spacing; ox += spacing) {
            for (let oy = startY; oy < h + spacing; oy += spacing) {
                // Determine the absolute world tile index for this cloud
                const worldX = ox + this.parent.cameraX + this.cloudOffset.x;
                const worldY = oy + this.parent.cameraY + this.cloudOffset.y;
                const gx = Math.round(worldX / spacing);
                const gy = Math.round(worldY / spacing);
                
                // Deterministic noise based on stable grid coordinates
                const noise = Math.abs(Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453) % 1;
                
                let threshold = 0.25; 
                if (weather.cloudType === CloudType.BROKEN) threshold = 0.6;

                if (noise < threshold) {
                    const shapeIdx = Math.floor(noise * 100) % this.cloudShapes.length;
                    
                    // Use noise to derive deterministic random properties
                    const rotation = noise * Math.PI * 2;
                    const scale = 0.8 + (noise * 10 % 1) * 0.7;
                    const jitterX = ((noise * 20 % 1) - 0.5) * (spacing * 0.4);
                    const jitterY = ((noise * 30 % 1) - 0.5) * (spacing * 0.4);

                    const individualAlpha = 0.3 + (noise / threshold) * 0.2;
                    lctx.globalAlpha = individualAlpha;

                    lctx.save();
                    // Translate to center of shadow placement
                    lctx.translate(ox + spacing/2 + jitterX, oy + spacing/2 + jitterY);
                    lctx.rotate(rotation);
                    lctx.scale(scale, scale);
                    // Draw centered
                    lctx.drawImage(this.cloudShapes[shapeIdx], -spacing/2, -spacing/2, spacing, spacing);
                    lctx.restore();
                }
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
        this.drawWorldSilhouette(mctx, '#ffffff', worldVersion, w, h);
        
        mctx.translate(-this.parent.cameraX, -this.parent.cameraY);
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
        // Base segments for all lights in view
        const globalSegments = this.parent.world!.getOcclusionSegments(this.parent.cameraX, this.parent.cameraY, w, h);
        
        lctx.save();
        lctx.globalCompositeOperation = 'screen';
        
        lights.forEach(light => {
            const screenX = light.x - this.parent.cameraX;
            const screenY = light.y - this.parent.cameraY;
            
            // Culling
            if (screenX < -light.radius || screenX > w + light.radius || screenY < -light.radius || screenY > h + light.radius) return;

            lctx.save();
            lctx.globalAlpha = light.intensity * (1.0 - ambientIntensity * 0.5);

            if (light.castsShadows) {
                let polygon = this.lightPolygonCache.get(light.id);
                const lastPos = (light as any)._lastShadowPos || {x: 0, y: 0};
                const hasMoved = Math.abs(light.x - lastPos.x) > 1 || Math.abs(light.y - lastPos.y) > 1;

                // Only recalculate if world changed or light moved
                if (!polygon || meshVersion !== this.meshVersion || hasMoved) {
                    let localSegments = globalSegments;
                    if (light.radius < 800) { 
                        localSegments = this.parent.world!.getOcclusionSegments(
                            light.x - light.radius, 
                            light.y - light.radius, 
                            light.radius * 2, 
                            light.radius * 2
                        );
                    }

                    polygon = VisibilitySystem.calculateVisibility({x: light.x, y: light.y}, localSegments, light.radius);
                    this.lightPolygonCache.set(light.id, polygon);
                    (light as any)._lastShadowPos = {x: light.x, y: light.y};
                }

                if (polygon && polygon.length > 0) {
                    lctx.beginPath();
                    lctx.moveTo(polygon[0].x - this.parent.cameraX, polygon[0].y - this.parent.cameraY);
                    for (let i = 1; i < polygon.length; i++) {
                        lctx.lineTo(polygon[i].x - this.parent.cameraX, polygon[i].y - this.parent.cameraY);
                    }
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
        const endAngle = this.parent.player.rotation + coneAngleRad / 2;

        const segments = this.parent.world!.getOcclusionSegments(
            this.parent.player.x - coneDist, 
            this.parent.player.y - coneDist, 
            coneDist * 2, 
            coneDist * 2
        );

        const polygon = VisibilitySystem.calculateVisibility(
            { x: this.parent.player.x, y: this.parent.player.y },
            segments,
            coneDist,
            startAngle,
            endAngle
        );
        
        lctx.save();
        if (polygon.length > 0) {
            lctx.beginPath();
            lctx.moveTo(polygon[0].x - this.parent.cameraX, polygon[0].y - this.parent.cameraY);
            for (let i = 1; i < polygon.length; i++) {
                lctx.lineTo(polygon[i].x - this.parent.cameraX, polygon[i].y - this.parent.cameraY);
            }
            lctx.lineTo(playerScreenX, playerScreenY); // Return to player center
            lctx.closePath();
            lctx.clip();
        }

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
        this.silhouetteChunks.clear();
        this.lightPolygonCache.clear();
    }
}