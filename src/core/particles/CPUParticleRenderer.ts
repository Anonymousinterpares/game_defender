import { ParticleData } from './ParticleData';
import { ParticleType, FLAG_IS_FLAME, MAX_PARTICLES } from '../ParticleConstants';
import { ConfigManager } from '../../config/MasterConfig';

export class CPUParticleRenderer {
    private data: ParticleData;
    private spriteCache: Map<string, HTMLCanvasElement> = new Map();
    private smokeCanvas: HTMLCanvasElement | null = null;
    private smokeCtx: CanvasRenderingContext2D | null = null;

    // Bucket map for O(N) rendering: Map<hash, bucket>
    private buckets: Map<number, { count: number, x: Float32Array, y: Float32Array, r: Float32Array }>;

    constructor(data: ParticleData) {
        this.data = data;
        this.buckets = new Map();
        this.generateSprites();
    }

    private generateSprites(): void {
        const createCachedCanvas = (size: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            draw(canvas.getContext('2d')!);
            return canvas;
        };

        // 1. Generic White Glow
        this.spriteCache.set('glow_white', createCachedCanvas(64, ctx => {
            const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
            grad.addColorStop(0.3, 'rgba(255, 255, 220, 0.8)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
        }));

        // 2. Flame Glows
        const flameColors = ['#fffbe6', '#ffcc00', '#ff4400', '#333', '#222', '#444', '#555', '#888'];
        flameColors.forEach(color => {
            this.spriteCache.set(`flame_${color}`, createCachedCanvas(32, ctx => {
                const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
                grad.addColorStop(0, color);
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, 32, 32);
            }));
        });

        // 3. Molten Outer Glow
        this.spriteCache.set('molten_glow', createCachedCanvas(64, ctx => {
            const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
            grad.addColorStop(0.2, 'rgba(255, 255, 0, 0.8)');
            grad.addColorStop(0.5, 'rgba(255, 68, 0, 0.5)');
            grad.addColorStop(1, 'rgba(255, 68, 0, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
        }));

        // 4. Smoke Sprite (Softer)
        this.spriteCache.set('smoke_soft', createCachedCanvas(64, ctx => {
            const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
            grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
        }));

        // 5. BLACK Smoke Sprite
        this.spriteCache.set('smoke_black', createCachedCanvas(64, ctx => {
            const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            grad.addColorStop(0, 'rgba(0, 0, 0, 0.8)');
            grad.addColorStop(0.4, 'rgba(20, 20, 20, 0.4)');
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
        }));

        // 6. HEAVY BLACK Smoke
        this.spriteCache.set('smoke_heavy_black', createCachedCanvas(64, ctx => {
            const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            grad.addColorStop(0, 'rgba(0, 0, 0, 0.95)');
            grad.addColorStop(0.3, 'rgba(5, 5, 5, 0.8)');
            grad.addColorStop(0.6, 'rgba(15, 15, 15, 0.4)');
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
        }));
    }

    public render(ctx: CanvasRenderingContext2D, camX: number, camY: number, alpha: number = 0): void {
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        const margin = 100;

        const config = ConfigManager.getInstance();
        const resScale = config.get<number>('Visuals', 'smokeResolutionScale') || 0.5;
        const maxSmoke = config.get<number>('Visuals', 'smokeMaxParticles') || 5000;

        // Initialize or resize smoke buffer if needed
        if (!this.smokeCanvas || this.smokeCanvas.width !== Math.ceil(w * resScale) || this.smokeCanvas.height !== Math.ceil(h * resScale)) {
            this.smokeCanvas = document.createElement('canvas');
            this.smokeCanvas.width = Math.ceil(w * resScale);
            this.smokeCanvas.height = Math.ceil(h * resScale);
            this.smokeCtx = this.smokeCanvas.getContext('2d', { alpha: true })!;
        }

        const sCtx = this.smokeCtx!;
        sCtx.clearRect(0, 0, this.smokeCanvas.width, this.smokeCanvas.height);
        sCtx.save();
        sCtx.scale(resScale, resScale);
        sCtx.translate(-camX, -camY);

        let currentAlpha = 1.0;
        let currentGCO = 'source-over';
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';

        if (!this.buckets) {
            this.buckets = new Map();
        }

        // Clear existing buckets
        this.buckets.forEach(bucket => bucket.count = 0);

        let smokeCount = 0;
        const d = this.data;

        for (let j = 0; j < d.activeCount; j++) {
            const i = d.activeIndices[j];

            const ix = d.prevX[i] + (d.x[i] - d.prevX[i]) * alpha;
            const iy = d.prevY[i] + (d.y[i] - d.prevY[i]) * alpha;

            const screenX = ix - camX;
            const screenY = iy - camY;
            if (screenX < -margin || screenX > w + margin || screenY < -margin || screenY > h + margin) {
                continue;
            }

            const iz = d.prevZ[i] + (d.z[i] - d.prevZ[i]) * alpha;
            const pType = d.type[i];
            const colorIdx = d.colorIdx[i];
            const lifeRatio = d.life[i] / d.maxLife[i];

            if (pType === ParticleType.STANDARD || pType === ParticleType.SMOKE) {
                if (d.flags[i] & FLAG_IS_FLAME) {
                    const targetAlpha = Math.max(0, lifeRatio);
                    if (Math.abs(currentAlpha - targetAlpha) > 0.01) {
                        ctx.globalAlpha = currentAlpha = targetAlpha;
                    }
                    const targetGCO = lifeRatio > 0.4 ? 'screen' : 'source-over';
                    if (currentGCO !== targetGCO) {
                        ctx.globalCompositeOperation = currentGCO = targetGCO;
                    }

                    const colorStr = d.colorPalette[colorIdx];
                    const sprite = this.spriteCache.get(`flame_${colorStr}`);
                    if (sprite) {
                        const r = d.radius[i];
                        ctx.drawImage(sprite, ix - r, iy - r, r * 2, r * 2);
                    }
                } else if (pType === ParticleType.SMOKE) {
                    // BUDGETING: Skip smoke if over limit
                    smokeCount++;
                    if (smokeCount > maxSmoke) continue;

                    const colorStr = d.colorPalette[colorIdx];
                    const isBlack = colorStr === '#000' || colorStr === '#111';

                    const targetAlpha = Math.max(0, lifeRatio * (isBlack ? 0.45 : 0.25));

                    // Draw to LOW-RES buffer
                    sCtx.globalAlpha = targetAlpha;
                    const sprite = this.spriteCache.get(isBlack ? (lifeRatio > 0.6 ? 'smoke_heavy_black' : 'smoke_black') : 'smoke_soft');
                    if (sprite) {
                        const r = d.radius[i];
                        sCtx.drawImage(sprite, ix - r, iy - r, r * 2, r * 2);
                    }
                } else {
                    // Standard solid particles - BUCKET THEM for high-res pass
                    const pAlpha = Math.max(0, lifeRatio);
                    const alphaIdx = Math.min(5, Math.ceil(pAlpha * 5)); // 1..5
                    const bucketKey = (colorIdx << 3) | alphaIdx; // Simple hash

                    let bucket = this.buckets.get(bucketKey);
                    if (!bucket) {
                        bucket = { count: 0, x: new Float32Array(MAX_PARTICLES), y: new Float32Array(MAX_PARTICLES), r: new Float32Array(MAX_PARTICLES) };
                        this.buckets.set(bucketKey, bucket);
                    }

                    bucket.x[bucket.count] = ix;
                    bucket.y[bucket.count] = iy;
                    bucket.r[bucket.count] = d.radius[i];
                    bucket.count++;
                }
            }
            else if (pType === ParticleType.SHOCKWAVE) {
                const ratio = 1 - lifeRatio;
                const currentRadius = d.radius[i] * Math.pow(ratio, 0.5);
                const targetAlpha = Math.max(0, 1 - ratio);
                if (Math.abs(currentAlpha - targetAlpha) > 0.01) {
                    ctx.globalAlpha = currentAlpha = targetAlpha;
                }
                if (currentGCO !== 'source-over') {
                    ctx.globalCompositeOperation = currentGCO = 'source-over';
                }

                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(ix, iy, currentRadius, 0, Math.PI * 2);
                ctx.stroke();
            }
            else if (pType === ParticleType.FLASH) {
                if (currentGCO !== 'screen') {
                    ctx.globalCompositeOperation = currentGCO = 'screen';
                }
                const sprite = this.spriteCache.get('glow_white');
                if (sprite) {
                    const r = d.radius[i];
                    if (Math.abs(currentAlpha - lifeRatio) > 0.01) {
                        ctx.globalAlpha = currentAlpha = lifeRatio;
                    }
                    ctx.drawImage(sprite, ix - r, iy - r, r * 2, r * 2);
                }
            }
            else if (pType === ParticleType.MOLTEN) {
                const ry = iy + iz;
                if (currentGCO !== 'screen') {
                    ctx.globalCompositeOperation = currentGCO = 'screen';
                }
                const glowRadius = d.radius[i] * (iz < 0 ? 6 : 4);
                const sprite = this.spriteCache.get('molten_glow');
                if (sprite) {
                    const mAlpha = iz < 0 ? 0.9 : (d.life[i] / 7.0) * 0.9;
                    const targetAlpha = Math.max(0, mAlpha);
                    if (Math.abs(currentAlpha - targetAlpha) > 0.01) {
                        ctx.globalAlpha = currentAlpha = targetAlpha;
                    }
                    ctx.drawImage(sprite, ix - glowRadius, ry - glowRadius, glowRadius * 2, glowRadius * 2);
                }

                if (currentAlpha !== 1.0) {
                    ctx.globalAlpha = currentAlpha = 1.0;
                }
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(ix, ry, d.radius[i] * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // COMPOSITE SMOKE BUFFER BACK
        sCtx.restore();
        ctx.save();
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';
        ctx.imageSmoothingEnabled = true;
        // Draw the offscreen canvas at full size
        ctx.drawImage(this.smokeCanvas, camX, camY, w, h);
        ctx.restore();

        // Render Buckets (High-res particles)
        if (currentGCO !== 'source-over') {
            ctx.globalCompositeOperation = 'source-over';
        }

        this.buckets.forEach((bucket, key) => {
            if (bucket.count === 0) return;

            const colorIdx = key >> 3;
            const alphaIdx = key & 7;
            const bucketAlpha = alphaIdx / 5; // 0.2, 0.4 ...

            ctx.fillStyle = d.colorPalette[colorIdx];
            ctx.globalAlpha = Math.min(1.0, bucketAlpha);
            ctx.beginPath();

            for (let k = 0; k < bucket.count; k++) {
                ctx.moveTo(bucket.x[k] + bucket.r[k], bucket.y[k]);
                ctx.arc(bucket.x[k], bucket.y[k], bucket.r[k], 0, Math.PI * 2);
            }
            ctx.fill();
        });

        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';
    }
}
