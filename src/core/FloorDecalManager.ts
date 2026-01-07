import { WeatherManager, WeatherType } from './WeatherManager';
import { EventBus, GameEvent } from './EventBus';

export interface Decal {
    x: number;
    y: number;
    radius: number;
    color: string;
    opacity: number;
    rotation: number;
    type: 'scorch' | 'metal' | 'puddle';
    seed: number; // For procedural consistency
    ttl?: number; 
}

export class FloorDecalManager {
    private static instance: FloorDecalManager;
    private decals: Decal[] = [];
    private maxDecals: number = 800;
    private bufferCanvas: HTMLCanvasElement | null = null;
    private bufferCtx: CanvasRenderingContext2D | null = null;
    private needsRedraw: boolean = true;
    private lastWorldSize: { w: number, h: number } = { w: 0, h: 0 };

    private constructor() {
        this.subscribeToEvents();
    }

    public static getInstance(): FloorDecalManager {
        if (!FloorDecalManager.instance) {
            FloorDecalManager.instance = new FloorDecalManager();
        }
        return FloorDecalManager.instance;
    }

    private subscribeToEvents(): void {
        const eb = EventBus.getInstance();

        eb.on(GameEvent.EXPLOSION, (data) => {
            this.addScorchMark(data.x, data.y, data.radius);
        });

        eb.on(GameEvent.PROJECTILE_HIT, (data) => {
            if (data.projectileType === 'cannon') {
                // Cannon impacts might leave small marks? 
                // For now just explosions.
            }
        });
    }

    private initBuffer(w: number, h: number): void {
        this.bufferCanvas = document.createElement('canvas');
        this.bufferCanvas.width = w;
        this.bufferCanvas.height = h;
        this.bufferCtx = this.bufferCanvas.getContext('2d');
        this.lastWorldSize = { w, h };
        this.needsRedraw = true;
    }

    // A simple seeded PRNG to ensure decals look the same every frame
    private seededRandom(seed: number): () => number {
        return function() {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
    }

    public addScorchMark(x: number, y: number, radius: number): void {
        this.decals.push({
            x,
            y,
            radius: radius * (1.0 + Math.random() * 0.5),
            color: '#000000',
            opacity: 0.5 + Math.random() * 0.3,
            rotation: Math.random() * Math.PI * 2,
            type: 'scorch',
            seed: Math.random() * 10000
        });

        if (this.decals.length > this.maxDecals) {
            this.decals.shift();
        }
        this.needsRedraw = true;
    }

    public addCooledMetalMark(x: number, y: number, radius: number): void {
        this.decals.push({
            x,
            y,
            radius: radius * (0.9 + Math.random() * 0.2),
            color: '#333333', 
            opacity: 0.8,
            rotation: Math.random() * Math.PI * 2,
            type: 'metal',
            seed: Math.random() * 10000
        });

        if (this.decals.length > this.maxDecals) {
            this.decals.shift();
        }
        this.needsRedraw = true;
    }

    public update(dt: number): void {
        const prevCount = this.decals.length;
        this.decals = this.decals.filter(d => {
            if (d.ttl !== undefined) {
                d.ttl -= dt;
                return d.ttl > 0;
            }
            return true;
        });
        if (this.decals.length !== prevCount) this.needsRedraw = true;
    }

    public render(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, worldW: number, worldH: number): void {
        const viewW = ctx.canvas.width;
        const viewH = ctx.canvas.height;
        const weather = WeatherManager.getInstance().getWeatherState();

        // Spawn puddles during rain
        if (weather.type === WeatherType.RAIN && Math.random() < 0.05) {
            this.decals.push({
                x: cameraX + Math.random() * viewW,
                y: cameraY + Math.random() * viewH,
                radius: 10 + Math.random() * 30,
                color: 'rgba(100, 150, 255, 0.2)',
                opacity: 0.3,
                rotation: Math.random() * Math.PI * 2,
                type: 'puddle',
                seed: Math.random() * 10000,
                ttl: 10 + Math.random() * 20
            });
            this.needsRedraw = true;
        }

        // Buffering Logic
        if (!this.bufferCanvas || worldW !== this.lastWorldSize.w || worldH !== this.lastWorldSize.h) {
            this.initBuffer(worldW, worldH);
        }

        if (this.needsRedraw && this.bufferCtx) {
            this.bufferCtx.clearRect(0, 0, worldW, worldH);
            this.decals.forEach(d => {
                if (d.type === 'scorch') {
                    this.renderRealisticScorch(this.bufferCtx!, d);
                } else if (d.type === 'metal') {
                    this.renderMetalDecal(this.bufferCtx!, d);
                } else if (d.type === 'puddle') {
                    this.renderPuddle(this.bufferCtx!, d);
                }
            });
            this.needsRedraw = false;
        }

        // Draw the cached buffer
        ctx.drawImage(this.bufferCanvas!, 0, 0);
    }

    private renderPuddle(ctx: CanvasRenderingContext2D, d: Decal): void {
        const rand = this.seededRandom(d.seed);
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rotation);
        ctx.globalAlpha = d.opacity * (d.ttl !== undefined ? Math.min(1, d.ttl) : 1);

        ctx.fillStyle = d.color;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const r = d.radius * (0.8 + rand() * 0.4);
            const px = Math.cos(angle) * r;
            const py = Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();

        // Shimmer/Reflection
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, d.radius * 0.6, 0, Math.PI, true);
        ctx.stroke();

        ctx.restore();
    }

    private renderRealisticScorch(ctx: CanvasRenderingContext2D, d: Decal): void {
        if (!isFinite(d.x) || !isFinite(d.y) || !isFinite(d.radius) || d.radius <= 0) return;
        const rand = this.seededRandom(d.seed);
        
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rotation);
        ctx.globalAlpha = d.opacity;

        // 1. Irregular Core (Mottled)
        const iterations = 6;
        for (let i = 0; i < iterations; i++) {
            const angle = (i / iterations) * Math.PI * 2 + d.seed;
            const dist = d.radius * 0.2 * rand();
            const rx = Math.cos(angle) * dist;
            const ry = Math.sin(angle) * dist;
            const r = Math.max(0.1, d.radius * (0.4 + rand() * 0.4));
            
            if (!isFinite(rx) || !isFinite(ry) || !isFinite(r) || r <= 0) continue;

            const grad = ctx.createRadialGradient(rx, ry, 0, rx, ry, r);
            grad.addColorStop(0, 'rgba(0,0,0,1)');
            grad.addColorStop(0.5, 'rgba(20,15,10,0.8)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(rx, ry, r, 0, Math.PI * 2);
            ctx.fill();
        }

        // 2. Radial Streaks (Pressure Spokes)
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1;
        const streaks = 8 + Math.floor(rand() * 8);
        for (let i = 0; i < streaks; i++) {
            const angle = (i / streaks) * Math.PI * 2 + (d.seed * 2);
            const length = d.radius * (0.6 + rand() * 0.5);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
            ctx.stroke();
        }

        // 3. Ashy Speckles
        ctx.fillStyle = 'rgba(40,40,40,0.6)';
        for (let i = 0; i < 15; i++) {
            const sa = rand() * Math.PI * 2;
            const sd = rand() * d.radius;
            const sx = Math.cos(sa) * sd;
            const sy = Math.sin(sa) * sd;
            const sr = 1 + rand() * 2;
            ctx.beginPath();
            ctx.arc(sx, sy, sr, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    private renderMetalDecal(ctx: CanvasRenderingContext2D, d: Decal): void {
        const rand = this.seededRandom(d.seed);
        
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rotation);
        ctx.globalAlpha = d.opacity;

        const r = Math.max(0.1, d.radius);
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        grad.addColorStop(0, '#111');
        grad.addColorStop(0.3, d.color);
        grad.addColorStop(0.7, '#555');
        grad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        // Slightly irregular shape for metal puddle
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const r = d.radius * (0.8 + rand() * 0.4);
            const px = Math.cos(angle) * r;
            const py = Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    public clear(): void {
        this.decals = [];
    }
}
