import { World } from '../World';
import { WorldRenderer } from './WorldRenderer';
import { Player } from '../../entities/Player';
import { Enemy } from '../../entities/Enemy';
import { Projectile } from '../../entities/Projectile';
import { Entity } from '../Entity';
import { WorldClock } from '../WorldClock';
import { LightManager } from '../LightManager';
import { Point } from '../VisibilitySystem';
import { ConfigManager } from '../../config/MasterConfig';
import { WeatherManager, WeatherType, CloudType } from '../WeatherManager';
import { PerfMonitor } from '../../utils/PerfMonitor';
import { Simulation } from '../Simulation';
import { ProjectionUtils } from '../../utils/ProjectionUtils';
import { MaterialType } from '../HeatMap';

export interface LightingParent {
    world: World | null;
    simulation: Simulation;
    worldRenderer: WorldRenderer;
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
    private resolutionScale: number = 0.5; // Render lights at 50% resolution

    private shadowChunks: Map<string, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, version: string }> = new Map();
    private rebuildQueue: string[] = [];
    private MAX_REBUILDS_PER_FRAME: number = 2;
    private silhouetteChunks: Map<string, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, version: number }> = new Map();
    private chunkSize: number = 512;
    private lightPolygonCache: Map<string, Point[]> = new Map();
    private meshVersion: number = 0;

    // Worker Pool for Lighting
    private workers: Worker[] = [];
    private workerIndex: number = 0;
    private pendingRequests: Map<string, boolean> = new Map();

    // Weather Visuals
    private cloudCanvas: HTMLCanvasElement;
    private cloudCtx: CanvasRenderingContext2D;
    private fogCanvas: HTMLCanvasElement;
    private fogCtx: CanvasRenderingContext2D;
    private fogNoise: HTMLCanvasElement | null = null;
    private fogOffset: { x: number, y: number } = { x: 0, y: 0 };
    private cloudOffset: { x: number, y: number } = { x: 0, y: 0 };
    private cloudShapes: HTMLCanvasElement[] = [];
    private splashes: { x: number, y: number, life: number, type: 'rain' | 'snow' }[] = [];
    private lastParticleUpdate: number = 0;
    private lastCameraPos: { x: number, y: number } = { x: -999, y: -999 };

    constructor(private parent: LightingParent) {
        this.resolutionScale = ConfigManager.getInstance().get<number>('Benchmark', 'resolutionScale') || 0.5;
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
        this.initWorkers();
    }

    private initWorkers(): void {
        const workerCount = Math.min(navigator.hardwareConcurrency || 4, 4);
        for (let i = 0; i < workerCount; i++) {
            const worker = new Worker(new URL('../../workers/lighting.worker.ts', import.meta.url), { type: 'module' });
            worker.onmessage = (e) => {
                const { type, data } = e.data;
                if (type === 'visibilityResult') {
                    this.lightPolygonCache.set(data.id, data.polygon);
                    this.pendingRequests.delete(data.id);
                }
            };
            this.workers.push(worker);
        }
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
                { ox: 0, oy: 0 }, { ox: size, oy: 0 }, { ox: -size, oy: 0 },
                { ox: 0, oy: size }, { ox: 0, oy: -size },
                { ox: size, oy: size }, { ox: size, oy: -size },
                { ox: -size, oy: size }, { ox: -size, oy: -size }
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

    public render(ctx: CanvasRenderingContext2D): void {
        this.renderLighting(ctx);
    }

    private drawWorldSilhouette(targetCtx: CanvasRenderingContext2D, color: string | null, meshVersion: number, w: number, h: number): void {
        const tctx = this.tempCtx;
        tctx.clearRect(0, 0, w, h);

        const tileSize = this.parent.world!.getTileSize();
        const startTx = Math.floor(this.parent.cameraX / tileSize);
        const endTx = Math.ceil((this.parent.cameraX + w) / tileSize);
        const startTy = Math.floor(this.parent.cameraY / tileSize);
        const endTy = Math.ceil((this.parent.cameraY + h) / tileSize);

        const cameraCenterX = this.parent.cameraX + w / 2;
        const cameraCenterY = this.parent.cameraY + h / 2;
        const WALL_HEIGHT = -32;

        tctx.save();
        tctx.translate(-this.parent.cameraX, -this.parent.cameraY);
        tctx.fillStyle = '#ffffff';

        for (let ty = startTy; ty <= endTy; ty++) {
            if (ty < 0 || ty >= this.parent.world!.getHeight()) continue;
            for (let tx = startTx; tx <= endTx; tx++) {
                if (tx < 0 || tx >= this.parent.world!.getWidth()) continue;

                const material = this.parent.world!.getTile(tx, ty);
                if (material === MaterialType.NONE) continue;

                const worldX = tx * tileSize;
                const worldY = ty * tileSize;
                
                // Base points
                const x0 = worldX;
                const y0 = worldY;
                const x1 = worldX + tileSize;
                const y1 = worldY + tileSize;

                // Projected points for the top face
                const offset = ProjectionUtils.getProjectedOffset(worldX + tileSize/2, worldY + tileSize/2, WALL_HEIGHT, cameraCenterX, cameraCenterY);
                const tx0 = x0 + offset.x;
                const ty0 = y0 + offset.y;
                const tx1 = x1 + offset.x;
                const ty1 = y1 + offset.y;

                // Draw Side silhouettes (only if visible)
                // Top side (visible if leaning down)
                if (offset.y > 0) {
                    tctx.beginPath();
                    tctx.moveTo(x0, y0); tctx.lineTo(x1, y0);
                    tctx.lineTo(tx1, ty0); tctx.lineTo(tx0, ty0);
                    tctx.fill();
                }
                // Bottom side (visible if leaning up)
                if (offset.y < 0) {
                    tctx.beginPath();
                    tctx.moveTo(x0, y1); tctx.lineTo(x1, y1);
                    tctx.lineTo(tx1, ty1); tctx.lineTo(tx0, ty1);
                    tctx.fill();
                }
                // Left side (visible if leaning right)
                if (offset.x > 0) {
                    tctx.beginPath();
                    tctx.moveTo(x0, y0); tctx.lineTo(x0, y1);
                    tctx.lineTo(tx0, ty1); tctx.lineTo(tx0, ty0);
                    tctx.fill();
                }
                // Right side (visible if leaning left)
                if (offset.x < 0) {
                    tctx.beginPath();
                    tctx.moveTo(x1, y0); tctx.lineTo(x1, y1);
                    tctx.lineTo(tx1, ty1); tctx.lineTo(tx1, ty0);
                    tctx.fill();
                }

                // Draw Top Face silhouette
                const heatMap = this.parent.world!.getHeatMap();
                const hpData = heatMap ? heatMap.getTileHP(tx, ty) : null;
                if (!hpData) {
                    tctx.fillRect(tx0, ty0, tileSize, tileSize);
                } else {
                    const subDiv = 10;
                    const subSize = tileSize / subDiv;
                    for (let sy = 0; sy < subDiv; sy++) {
                        for (let sx = 0; sx < subDiv; sx++) {
                            if (hpData[sy * subDiv + sx] > 0) {
                                tctx.fillRect(tx0 + sx * subSize, ty0 + sy * subSize, subSize, subSize);
                            }
                        }
                    }
                }
            }
        }
        tctx.restore();

        if (color) {
            tctx.globalCompositeOperation = 'source-in';
            tctx.fillStyle = color;
            tctx.fillRect(0, 0, w, h);
            tctx.globalCompositeOperation = 'source-over';
        }

        targetCtx.drawImage(this.tempCanvas, 0, 0);
    }

    private renderLighting(ctx: CanvasRenderingContext2D): void {
        const lightingEnabled = ConfigManager.getInstance().get<boolean>('Lighting', 'enabled');
        if (!lightingEnabled || !this.parent.world) return;

        const fullW = ctx.canvas.width;
        const fullH = ctx.canvas.height;
        const w = Math.floor(fullW * this.resolutionScale);
        const h = Math.floor(fullH * this.resolutionScale);

        const worldMeshVersion = this.parent.world.getMeshVersion();
        const lightsCount = LightManager.getInstance().getLights().length;

        const weather = WeatherManager.getInstance().getWeatherState();
        const isWeatherActive = weather.precipitationIntensity > 0.05 || weather.fogDensity > 0.05 || weather.cloudType !== CloudType.NONE;

        const { sun, moon, baseAmbient, isDaylight, totalSeconds } = WorldClock.getInstance().getTimeState();

        // Skip entirely if static AND no active weather AND time hasn't changed much
        const camMoved = Math.abs(this.parent.cameraX - this.lastCameraPos.x) > 0.5 ||
            Math.abs(this.parent.cameraY - this.lastCameraPos.y) > 0.5;
        const timeChanged = Math.abs(totalSeconds - ((this as any)._lastTotalSeconds || 0)) > 0.1;

        if (!camMoved && !timeChanged && !isWeatherActive && worldMeshVersion === this.meshVersion && (this as any)._lastLightsCount === lightsCount && !this.parent.isFiringBeam && !this.parent.isFiringFlamethrower) {
            ctx.save();
            ctx.globalCompositeOperation = 'multiply';
            ctx.drawImage(this.lightCanvas, 0, 0, fullW, fullH);
            ctx.restore();
            return;
        }

        this.lastCameraPos.x = this.parent.cameraX;
        this.lastCameraPos.y = this.parent.cameraY;
        (this as any)._lastTotalSeconds = totalSeconds;
        (this as any)._lastLightsCount = lightsCount;

        PerfMonitor.getInstance().begin('lighting_setup');

        if (this.lightCanvas.width !== w || this.lightCanvas.height !== h) {
            this.lightCanvas.width = w; this.lightCanvas.height = h;
            this.maskCanvas.width = w; this.maskCanvas.height = h;
            this.sourceCanvas.width = w; this.sourceCanvas.height = h;
            this.tempCanvas.width = fullW; this.tempCanvas.height = fullH;
            this.fogCanvas.width = fullW; this.fogCanvas.height = fullH;
        }

        const lctx = this.lightCtx;

        // Scale for internal lighting coordinates
        lctx.save();
        lctx.scale(this.resolutionScale, this.resolutionScale);

        // 1. BASE FLOOR
        lctx.globalCompositeOperation = 'source-over';
        lctx.fillStyle = baseAmbient;
        lctx.fillRect(0, 0, fullW, fullH);
        PerfMonitor.getInstance().end('lighting_setup');

        // 2. SUN/MOON (Additive)
        PerfMonitor.getInstance().begin('lighting_directional');
        if (sun.active) this.renderDirectionalLight(lctx, sun, 'sun', worldMeshVersion, fullW, fullH);
        if (moon.active) this.renderDirectionalLight(lctx, moon, 'moon', worldMeshVersion, fullW, fullH);
        PerfMonitor.getInstance().end('lighting_directional');

        // 3. ENTITY AMBIENT REVEAL
        lctx.save();
        lctx.globalCompositeOperation = 'screen';
        const silColor = isDaylight ? 'rgb(70, 65, 60)' : 'rgb(30, 35, 50)';
        this.drawWorldSilhouette(lctx, silColor, worldMeshVersion, fullW, fullH);

        lctx.translate(-this.parent.cameraX, -this.parent.cameraY);
        const alpha = this.parent.simulation.physicsSystem.alpha;
        this.parent.simulation.renderSystem.renderSilhouettes(this.parent.simulation.entityManager, lctx, alpha, silColor, this.parent.cameraX, this.parent.cameraY);
        lctx.restore();

        // 4. VISION
        if (this.parent.player) {
            lctx.save();
            lctx.globalCompositeOperation = 'screen';
            this.renderVisionLight(lctx);
            lctx.restore();
        }

        // 5. POINT LIGHTS
        PerfMonitor.getInstance().begin('lighting_point');
        const activeIntensity = isDaylight ? sun.intensity : moon.intensity;
        this.renderPointLights(lctx, activeIntensity, worldMeshVersion, fullW, fullH);
        PerfMonitor.getInstance().end('lighting_point');

        // 6. CLOUD SHADOWS
        if (weather.cloudType !== CloudType.NONE) {
            this.renderCloudShadows(lctx, weather, fullW, fullH);
        }
        lctx.restore(); // End of resolution scaling

        this.meshVersion = worldMeshVersion;

        // 7. APPLY LIGHTMAP TO WORLD
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        // Draw low-res lightmap scaled up
        ctx.drawImage(this.lightCanvas, 0, 0, fullW, fullH);
        ctx.restore();

        // 8. POST-LIGHTING OVERLAYS
        PerfMonitor.getInstance().begin('lighting_overlays');
        if (weather.fogDensity > 0.05) {
            this.renderFogOverlay(ctx, weather, fullW, fullH);
        }
        this.renderParticles(ctx);
        PerfMonitor.getInstance().end('lighting_overlays');
    }

    private renderFogOverlay(ctx: CanvasRenderingContext2D, weather: any, w: number, h: number): void {
        const { sun, moon, isDaylight } = WorldClock.getInstance().getTimeState();
        const fctx = this.fogCtx;

        fctx.clearRect(0, 0, w, h);

        const lightIntensity = isDaylight ? sun.intensity : Math.max(moon.intensity, 0.02);
        const baseFogRGB = weather.type === WeatherType.SNOW ? [210, 225, 255] : [160, 170, 190];

        const r = Math.floor(baseFogRGB[0] * lightIntensity);
        const g = Math.floor(baseFogRGB[1] * lightIntensity);
        const b = Math.floor(baseFogRGB[2] * lightIntensity);
        const fogColor = `rgb(${r}, ${g}, ${b})`;

        const dt = 1 / 60;
        this.fogOffset.x += weather.windDir.x * weather.windSpeed * 10 * dt;
        this.fogOffset.y += weather.windDir.y * weather.windSpeed * 10 * dt;

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

        fctx.save();
        fctx.globalCompositeOperation = 'source-in';
        fctx.fillStyle = fogColor;
        fctx.fillRect(0, 0, w, h);
        fctx.restore();

        fctx.save();
        fctx.globalCompositeOperation = 'destination-over';
        fctx.fillStyle = fogColor;
        fctx.globalAlpha = 0.5;
        fctx.fillRect(0, 0, w, h);
        fctx.restore();

        ctx.save();
        if (isDaylight) {
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = weather.fogDensity * 0.5;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = weather.fogDensity * 0.7;
        }
        ctx.drawImage(this.fogCanvas, 0, 0);
        ctx.restore();
    }

    private renderCloudShadows(lctx: CanvasRenderingContext2D, weather: any, w: number, h: number): void {
        const dt = 1 / 60;
        this.cloudOffset.x += weather.cloudWindDir.x * weather.cloudWindSpeed * 15 * dt;
        this.cloudOffset.y += weather.cloudWindDir.y * weather.cloudWindSpeed * 15 * dt;

        lctx.save();
        lctx.globalCompositeOperation = 'multiply';

        if (weather.cloudType === CloudType.OVERCAST) {
            lctx.fillStyle = 'rgba(120, 130, 150, 0.5)';
            lctx.fillRect(0, 0, w, h);
            lctx.restore();
            return;
        }

        lctx.globalAlpha = 0.4;
        const spacing = 400;
        const startX = Math.floor((this.parent.cameraX + this.cloudOffset.x) / spacing) * spacing - (this.parent.cameraX + this.cloudOffset.x);
        const startY = Math.floor((this.parent.cameraY + this.cloudOffset.y) / spacing) * spacing - (this.parent.cameraY + this.cloudOffset.y);

        for (let ox = startX; ox < w + spacing; ox += spacing) {
            for (let oy = startY; oy < h + spacing; oy += spacing) {
                const worldX = ox + this.parent.cameraX + this.cloudOffset.x;
                const worldY = oy + this.parent.cameraY + this.cloudOffset.y;
                const gx = Math.round(worldX / spacing);
                const gy = Math.round(worldY / spacing);
                const noise = Math.abs(Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453) % 1;

                let threshold = 0.25;
                if (weather.cloudType === CloudType.BROKEN) threshold = 0.6;

                if (noise < threshold) {
                    const shapeIdx = Math.floor(noise * 100) % this.cloudShapes.length;
                    const rotation = noise * Math.PI * 2;
                    const scale = 0.8 + (noise * 10 % 1) * 0.7;
                    const jitterX = ((noise * 20 % 1) - 0.5) * (spacing * 0.4);
                    const jitterY = ((noise * 30 % 1) - 0.5) * (spacing * 0.4);
                    lctx.globalAlpha = 0.3 + (noise / threshold) * 0.2;
                    lctx.save();
                    lctx.translate(ox + spacing / 2 + jitterX, oy + spacing / 2 + jitterY);
                    lctx.rotate(rotation);
                    lctx.scale(scale, scale);
                    lctx.drawImage(this.cloudShapes[shapeIdx], -spacing / 2, -spacing / 2, spacing, spacing);
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

        const camDx = (this.parent.cameraX - (this as any)._lastCamX || 0);
        const camDy = (this.parent.cameraY - (this as any)._lastCamY || 0);
        (this as any)._lastCamX = this.parent.cameraX;
        (this as any)._lastCamY = this.parent.cameraY;

        ctx.save();
        this.splashes = this.splashes.filter(s => s.life > 0);
        this.splashes.forEach(s => {
            s.life -= dt * 4;
            const sx = s.x - this.parent.cameraX;
            const sy = s.y - this.parent.cameraY;
            if (sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50) s.life = 0;
            if (s.life > 0) {
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
            }
        });

        const particles = this.parent.simulation.weatherSystemECS.getParticles();
        const weatherSplashes = this.parent.simulation.weatherSystemECS.getSplashes();
        weatherSplashes.forEach(splash => {
            this.splashes.push({ x: splash.x, y: splash.y, life: 1.0, type: splash.type as 'rain' | 'snow' });
        });

        if (weather.precipitationIntensity > 0.05) {
            if (weather.type === WeatherType.RAIN) {
                ctx.strokeStyle = 'rgba(160, 190, 255, 0.4)';
                ctx.lineWidth = 1;
                particles.forEach((p: any) => {
                    const parallaxMult = p.z / 500;
                    const screenX = (p.x - this.parent.cameraX) - (camDx * parallaxMult * 10);
                    const screenY = (p.y - this.parent.cameraY) - (camDy * parallaxMult * 10);
                    if (screenX < -50 || screenX > w + 50 || screenY < -50 || screenY > h + 50) return;
                    if (p.z <= 10 && Math.random() < 0.2 && this.splashes.length < 200) {
                        this.splashes.push({ x: screenX + this.parent.cameraX, y: screenY + this.parent.cameraY, life: 1.0, type: 'rain' });
                    }
                    const speedSq = p.vx * p.vx + p.vy * p.vy;
                    const speedFactor = Math.min(2.0, 1.0 + speedSq / 200000);
                    ctx.beginPath();
                    ctx.moveTo(screenX, screenY - p.z * 0.2);
                    ctx.lineTo(screenX + p.vx * 0.03 * speedFactor, (screenY - p.z * 0.2) + 15 * speedFactor);
                    ctx.stroke();
                });
            } else if (weather.type === WeatherType.SNOW) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                particles.forEach((p: any) => {
                    const parallaxMult = p.z / 500;
                    const screenX = (p.x - this.parent.cameraX) - (camDx * parallaxMult * 10);
                    const screenY = (p.y - this.parent.cameraY) - (camDy * parallaxMult * 10);
                    if (screenX < -50 || screenX > w + 50 || screenY < -50 || screenY > h + 50) return;
                    if (p.z <= 10 && Math.random() < 0.1 && this.splashes.length < 200) {
                        this.splashes.push({ x: screenX + this.parent.cameraX, y: screenY + this.parent.cameraY, life: 1.0, type: 'snow' });
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
        const mctx = this.maskCtx;
        sctx.clearRect(0, 0, w, h);
        mctx.clearRect(0, 0, w, h);
        sctx.save();
        mctx.save();
        sctx.scale(this.resolutionScale, this.resolutionScale);
        mctx.scale(this.resolutionScale, this.resolutionScale);
        sctx.translate(-this.parent.cameraX, -this.parent.cameraY);
        mctx.translate(-this.parent.cameraX, -this.parent.cameraY);
        sctx.fillStyle = source.color;
        sctx.fillRect(this.parent.cameraX, this.parent.cameraY, w / this.resolutionScale, h / this.resolutionScale);

        const angle = Math.atan2(source.direction.y, source.direction.x);
        const bakeVersion = `${worldVersion}_${Math.round(angle * 100)}_${type}`;
        const startGX = Math.floor(this.parent.cameraX / this.chunkSize);
        const endGX = Math.floor((this.parent.cameraX + (w / this.resolutionScale)) / this.chunkSize);
        const startGY = Math.floor(this.parent.cameraY / this.chunkSize);
        const endGY = Math.floor((this.parent.cameraY + (h / this.resolutionScale)) / this.chunkSize);

        mctx.fillStyle = '#000000';
        let rebuildsThisFrame = 0;
        for (let gy = startGY; gy <= endGY; gy++) {
            for (let gx = startGX; gx <= endGX; gx++) {
                const key = `${gx},${gy}_${type}`;
                let chunk = this.shadowChunks.get(key);
                if (!chunk) {
                    const canvas = document.createElement('canvas');
                    canvas.width = this.chunkSize; canvas.height = this.chunkSize;
                    chunk = { canvas, ctx: canvas.getContext('2d')!, version: '' };
                    this.shadowChunks.set(key, chunk);
                }
                if (chunk.version !== bakeVersion) {
                    if (rebuildsThisFrame < this.MAX_REBUILDS_PER_FRAME) {
                        this.rebuildShadowChunk(chunk, gx, gy, source);
                        chunk.version = bakeVersion;
                        rebuildsThisFrame++;
                    } else if (!this.rebuildQueue.includes(key)) {
                        this.rebuildQueue.push(key);
                    }
                }
                mctx.drawImage(chunk.canvas, gx * this.chunkSize, gy * this.chunkSize);
            }
        }

        const entities: Entity[] = [];
        if (this.parent.player) { entities.push(this.parent.player); entities.push(...this.parent.player.segments); }
        entities.push(...this.parent.enemies);
        entities.forEach(e => { if (e.active) this.renderEntityShadow(mctx, e, source.direction, source.shadowLen); });

        mctx.globalCompositeOperation = 'destination-out';
        if (this.parent.worldRenderer) this.parent.worldRenderer.renderAsSilhouette(mctx, this.parent.cameraX, this.parent.cameraY);
        const alphaShadow = this.parent.simulation.physicsSystem.alpha;
        this.parent.simulation.renderSystem.renderSilhouettes(this.parent.simulation.entityManager, mctx, alphaShadow, '#ffffff', this.parent.cameraX, this.parent.cameraY);

        mctx.restore();
        sctx.restore();
        sctx.save();
        sctx.globalCompositeOperation = 'destination-out';
        sctx.drawImage(this.maskCanvas, 0, 0);
        sctx.restore();

        targetCtx.save();
        targetCtx.globalCompositeOperation = 'screen';
        targetCtx.globalAlpha = source.intensity;
        targetCtx.drawImage(this.sourceCanvas, 0, 0, w / this.resolutionScale, h / this.resolutionScale);
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
        const wallHeight = 8;
        segments.forEach((seg: any) => {
            const groundA = seg.a; const groundB = seg.b;
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

    private renderEntityShadow(ctx: CanvasRenderingContext2D, e: Entity, dir: { x: number, y: number }, len: number): void {
        const ex = e.x; const ey = e.y; const r = e.radius;
        const angle = Math.atan2(dir.y, dir.x);
        const t1x = ex + Math.cos(angle - Math.PI / 2) * r;
        const t1y = ey + Math.sin(angle - Math.PI / 2) * r;
        const t2x = ex + Math.cos(angle + Math.PI / 2) * r;
        const t2y = ey + Math.sin(angle + Math.PI / 2) * r;
        const t3x = t2x + dir.x * len; const t3y = t2y + dir.y * len;
        const t4x = t1x + dir.x * len; const t4y = t1y + dir.y * len;
        ctx.beginPath(); ctx.moveTo(t1x, t1y); ctx.lineTo(t2x, t2y); ctx.lineTo(t3x, t3y); ctx.lineTo(t4x, t4y); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(ex + dir.x * len, ey + dir.y * len, r, 0, Math.PI * 2); ctx.fill();
    }

    private renderPointLights(lctx: CanvasRenderingContext2D, ambientIntensity: number, meshVersion: number, w: number, h: number): void {
        const lights = LightManager.getInstance().getLights();
        const globalSegments = this.parent.world!.getOcclusionSegments(this.parent.cameraX, this.parent.cameraY, w, h);
        lctx.save();
        lctx.globalCompositeOperation = 'screen';
        let shadowLightsCount = 0;
        const MAX_SHADOW_LIGHTS = 8;
        lights.forEach(light => {
            const screenX = light.x - this.parent.cameraX;
            const screenY = light.y - this.parent.cameraY;
            if (screenX < -light.radius || screenX > w + light.radius || screenY < -light.radius || screenY > h + light.radius) return;
            lctx.save();
            lctx.globalAlpha = light.intensity * (1.0 - ambientIntensity * 0.5);
            if (light.castsShadows && shadowLightsCount < MAX_SHADOW_LIGHTS) {
                shadowLightsCount++;
                const polygon = this.lightPolygonCache.get(light.id);
                const lastPos = (light as any)._lastShadowPos || { x: 0, y: 0 };
                const hasMoved = Math.abs(light.x - lastPos.x) > 2 || Math.abs(light.y - lastPos.y) > 2;
                if (meshVersion !== this.meshVersion || hasMoved) {
                    if (!this.pendingRequests.has(light.id)) {
                        this.pendingRequests.set(light.id, true);
                        const worker = this.workers[this.workerIndex];
                        this.workerIndex = (this.workerIndex + 1) % this.workers.length;
                        let cachedSegs = (light as any)._cachedSegments;
                        if (meshVersion !== this.meshVersion || !cachedSegs || hasMoved) {
                            cachedSegs = this.parent.world!.getOcclusionSegments(light.x - light.radius, light.y - light.radius, light.radius * 2, light.radius * 2);
                            (light as any)._cachedSegments = cachedSegs;
                        }
                        worker.postMessage({ type: 'calculateVisibility', data: { id: light.id, origin: { x: light.x, y: light.y }, segments: cachedSegs, radius: light.radius } });
                        (light as any)._lastShadowPos = { x: light.x, y: light.y };
                    }
                }
                if (polygon && polygon.length > 0) {
                    lctx.beginPath();
                    lctx.moveTo(polygon[0].x - this.parent.cameraX, polygon[0].y - this.parent.cameraY);
                    for (let i = 1; i < polygon.length; i++) lctx.lineTo(polygon[i].x - this.parent.cameraX, polygon[i].y - this.parent.cameraY);
                    lctx.closePath(); lctx.clip();
                }
            }
            const grad = lctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, light.radius);
            grad.addColorStop(0, light.color); grad.addColorStop(1, 'rgba(0,0,0,0)');
            lctx.fillStyle = grad; lctx.fillRect(screenX - light.radius, screenY - light.radius, light.radius * 2, light.radius * 2);
            lctx.restore();
        });
        lctx.restore();
    }

    private renderVisionLight(lctx: CanvasRenderingContext2D): void {
        if (!this.parent.player || !this.parent.world) return;
        const { moonPhase } = WorldClock.getInstance().getTimeState();
        const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');
        const revealColor = `rgba(180, 200, 255, ${0.5 + (moonPhase * 0.3)})`;
        const segRad = ConfigManager.getInstance().get<number>('Visuals', 'segmentVisibilityRadius') * tileSize;
        const coneDist = ConfigManager.getInstance().get<number>('Visuals', 'coneDistance') * tileSize;
        const coneAngleRad = (ConfigManager.getInstance().get<number>('Visuals', 'coneAngle') * Math.PI) / 180;

        this.parent.player.getAllBodies().forEach((b: any) => {
            const screenX = b.x - this.parent.cameraX;
            const screenY = b.y - this.parent.cameraY;
            const grad = lctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, segRad);
            grad.addColorStop(0, revealColor); grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            lctx.fillStyle = grad; lctx.beginPath(); lctx.arc(screenX, screenY, segRad, 0, Math.PI * 2); lctx.fill();
        });

        const playerScreenX = this.parent.player.x - this.parent.cameraX;
        const playerScreenY = this.parent.player.y - this.parent.cameraY;
        const startAngle = this.parent.player.rotation - coneAngleRad / 2;
        const endAngle = this.parent.player.rotation + coneAngleRad / 2;
        const visionId = 'player_vision';
        const lastVisionPos = (this.parent.player as any)._lastVisionPos || { x: 0, y: 0, rot: 0 };
        const hasMoved = Math.abs(this.parent.player.x - lastVisionPos.x) > 1 || Math.abs(this.parent.player.y - lastVisionPos.y) > 1 || Math.abs(this.parent.player.rotation - lastVisionPos.rot) > 0.05;

        if (this.parent.world.getMeshVersion() !== this.meshVersion || hasMoved) {
            if (!this.pendingRequests.has(visionId)) {
                this.pendingRequests.set(visionId, true);
                const segments = this.parent.world!.getOcclusionSegments(this.parent.player.x - coneDist, this.parent.player.y - coneDist, coneDist * 2, coneDist * 2);
                const worker = this.workers[this.workerIndex];
                this.workerIndex = (this.workerIndex + 1) % this.workers.length;
                worker.postMessage({ type: 'calculateVisibility', data: { id: visionId, origin: { x: this.parent.player.x, y: this.parent.player.y }, segments, radius: coneDist, startAngle, endAngle } });
                (this.parent.player as any)._lastVisionPos = { x: this.parent.player.x, y: this.parent.player.y, rot: this.parent.player.rotation };
            }
        }

        const polygon = this.lightPolygonCache.get(visionId);
        lctx.save();
        if (polygon && polygon.length > 0) {
            lctx.beginPath();
            lctx.moveTo(polygon[0].x - this.parent.cameraX, polygon[0].y - this.parent.cameraY);
            for (let i = 1; i < polygon.length; i++) lctx.lineTo(polygon[i].x - this.parent.cameraX, polygon[i].y - this.parent.cameraY);
            lctx.lineTo(playerScreenX, playerScreenY); lctx.closePath(); lctx.clip();
        }
        const coneGrad = lctx.createRadialGradient(playerScreenX, playerScreenY, 0, playerScreenX, playerScreenY, coneDist);
        coneGrad.addColorStop(0, revealColor); coneGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        lctx.fillStyle = coneGrad; lctx.fillRect(playerScreenX - coneDist, playerScreenY - coneDist, coneDist * 2, coneDist * 2);
        lctx.restore();
    }

    public clearCache(): void {
        this.shadowChunks.clear();
        this.silhouetteChunks.clear();
        this.lightPolygonCache.clear();
    }
}
