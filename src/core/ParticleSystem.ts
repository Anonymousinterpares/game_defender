import { Entity } from './Entity';
import { World } from './World';
import { ParticleType, FLAG_ACTIVE, FLAG_IS_FLAME, MAX_PARTICLES } from './ParticleConstants';

export class ParticleSystem {
    private static instance: ParticleSystem;
    
    private sharedBuffer: SharedArrayBuffer;
    private x: Float32Array;
    private y: Float32Array;
    private z: Float32Array;
    private prevX: Float32Array;
    private prevY: Float32Array;
    private prevZ: Float32Array;
    private vx: Float32Array;
    private vy: Float32Array;
    private vz: Float32Array;
    private life: Float32Array;
    private maxLife: Float32Array;
    private radius: Float32Array;
    private startRadius: Float32Array;
    private type: Uint8Array;
    private flags: Uint8Array;
    private colorIdx: Uint32Array;

    private colorPalette: string[] = [];
    private nextFreeIdx: number = 0;
    
    private worker: Worker;
    private isWorkerBusy: boolean = false;
    
    // For handling events from worker
    private pendingDamage: { targetIdx: number, damage: number }[] = [];
    private pendingHeat: { x: number, y: number, intensity: number, radius: number }[] = [];

    private constructor() {
        // Calculate total size: 13 Float32 arrays + 1 Uint32 array + 2 Uint8 arrays
        // Note: Uint8 arrays need 4-byte alignment for subsequent 32-bit arrays
        const count = MAX_PARTICLES;
        const f32Size = count * 4;
        const u32Size = count * 4;
        const u8SizeAligned = (count + 3) & ~3;
        
        const totalSize = (13 * f32Size) + (1 * u32Size) + (2 * u8SizeAligned);
        
        try {
            this.sharedBuffer = new (window.SharedArrayBuffer || ArrayBuffer)(totalSize) as any;
        } catch (e) {
            console.warn("SharedArrayBuffer not available, falling back to main thread physics.");
            this.sharedBuffer = new ArrayBuffer(totalSize) as any;
        }

        let offset = 0;
        const getF32 = () => {
            const arr = new Float32Array(this.sharedBuffer, offset, count);
            offset += f32Size;
            return arr;
        };
        const getU32 = () => {
            const arr = new Uint32Array(this.sharedBuffer, offset, count);
            offset += u32Size;
            return arr;
        };
        const getU8 = () => {
            const arr = new Uint8Array(this.sharedBuffer, offset, count);
            offset += u8SizeAligned;
            return arr;
        };

        this.x = getF32(); this.y = getF32(); this.z = getF32();
        this.prevX = getF32(); this.prevY = getF32(); this.prevZ = getF32();
        this.vx = getF32(); this.vy = getF32(); this.vz = getF32();
        this.life = getF32(); this.maxLife = getF32();
        this.radius = getF32(); this.startRadius = getF32();
        this.type = getU8();
        this.flags = getU8();
        this.colorIdx = getU32();

        // Initialize Worker
        this.worker = new Worker(new URL('../workers/particle.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => {
            const { type, data } = e.data;
            if (type === 'updated') {
                this.isWorkerBusy = false;
            } else if (type === 'events') {
                this.pendingDamage.push(...data.damageEvents);
                this.pendingHeat.push(...data.heatEvents);
            }
        };
    }

    public static getInstance(): ParticleSystem {
        if (!ParticleSystem.instance) {
            ParticleSystem.instance = new ParticleSystem();
        }
        return ParticleSystem.instance;
    }

    public initWorker(world: World): void {
        this.worker.postMessage({
            type: 'init',
            data: {
                buffer: this.sharedBuffer,
                worldData: {
                    width: (world as any).width,
                    height: (world as any).height,
                    tileSize: (world as any).tileSize,
                    tilesBuffer: world.getTilesSharedBuffer()
                }
            }
        });
    }

    private getNextIndex(): number {
        for (let i = 0; i < MAX_PARTICLES; i++) {
            const idx = (this.nextFreeIdx + i) % MAX_PARTICLES;
            if (!(this.flags[idx] & FLAG_ACTIVE)) {
                this.nextFreeIdx = (idx + 1) % MAX_PARTICLES;
                return idx;
            }
        }
        return -1;
    }

    private getColorIndex(color: string): number {
        let idx = this.colorPalette.indexOf(color);
        if (idx === -1) {
            idx = this.colorPalette.length;
            this.colorPalette.push(color);
        }
        return idx;
    }

    public spawnParticle(x: number, y: number, color: string, vx: number, vy: number, life: number = 0.5): number {
        const i = this.getNextIndex();
        if (i === -1) return -1;
        this.x[i] = x; this.y[i] = y; this.z[i] = 0;
        this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = 0;
        this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = 0;
        this.life[i] = life; this.maxLife[i] = life;
        this.radius[i] = 1 + Math.random() * 2;
        this.startRadius[i] = this.radius[i];
        this.type[i] = ParticleType.STANDARD;
        this.colorIdx[i] = this.getColorIndex(color);
        this.flags[i] = FLAG_ACTIVE;
        return i;
    }

    public spawnShockwave(x: number, y: number, radius: number): number {
        const i = this.getNextIndex();
        if (i === -1) return -1;
        this.x[i] = x; this.y[i] = y; this.z[i] = 0;
        this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = 0;
        this.vx[i] = 0; this.vy[i] = 0; this.vz[i] = 0;
        this.life[i] = 0.4; this.maxLife[i] = 0.4;
        this.radius[i] = radius;
        this.type[i] = ParticleType.SHOCKWAVE;
        this.colorIdx[i] = this.getColorIndex('#fff');
        this.flags[i] = FLAG_ACTIVE;
        return i;
    }

    public spawnFlash(x: number, y: number, radius: number): number {
        const i = this.getNextIndex();
        if (i === -1) return -1;
        this.x[i] = x; this.y[i] = y; this.z[i] = 0;
        this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = 0;
        this.vx[i] = 0; this.vy[i] = 0; this.vz[i] = 0;
        this.life[i] = 0.15; this.maxLife[i] = 0.15;
        this.radius[i] = radius;
        this.type[i] = ParticleType.FLASH;
        this.colorIdx[i] = this.getColorIndex('#fff');
        this.flags[i] = FLAG_ACTIVE;
        return i;
    }

    public spawnMoltenMetal(x: number, y: number, vx: number, vy: number): number {
        const i = this.getNextIndex();
        if (i === -1) return -1;
        const life = 5.0 + Math.random() * 2.0;
        this.x[i] = x; this.y[i] = y; this.z[i] = 0;
        this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = 0;
        this.vx[i] = vx; this.vy[i] = vy;
        this.vz[i] = -60 - Math.random() * 40;
        this.life[i] = life; this.maxLife[i] = life;
        this.radius[i] = 4 + Math.random() * 2;
        this.type[i] = ParticleType.MOLTEN;
        this.colorIdx[i] = this.getColorIndex('#ffff00');
        this.flags[i] = FLAG_ACTIVE;
        return i;
    }

    public setFlame(idx: number, isFlame: boolean): void {
        if (idx === -1) return;
        if (isFlame) this.flags[idx] |= FLAG_IS_FLAME;
        else this.flags[idx] &= ~FLAG_IS_FLAME;
    }

    public update(dt: number, world: World | null, player: Entity | null, enemies: Entity[]): void {
        // Process pending events from the worker
        this.processWorkerEvents(player, enemies, world);

        const useWorker = typeof SharedArrayBuffer !== 'undefined' && this.sharedBuffer instanceof SharedArrayBuffer;

        if (useWorker) {
            if (!this.isWorkerBusy) {
                this.isWorkerBusy = true;
                this.worker.postMessage({
                    type: 'update',
                    data: {
                        dt,
                        player: player ? { x: player.x, y: player.y, radius: player.radius, active: player.active } : null,
                        enemies: enemies.map(e => ({ x: e.x, y: e.y, radius: e.radius, active: e.active }))
                    }
                });
            }
        } else {
            // Fallback: Run same logic as worker but on main thread
            this.updateMainThread(dt, world, player, enemies);
        }
        
        // Final updates that need to happen on main thread (like color shifts)
        // for rendering synchronization.
        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (!(this.flags[i] & FLAG_ACTIVE)) continue;
            
            const lifeRatio = this.life[i] / this.maxLife[i];
            if (this.flags[i] & FLAG_IS_FLAME) {
                if (lifeRatio > 0.7) this.colorIdx[i] = this.getColorIndex('#fffbe6');
                else if (lifeRatio > 0.4) this.colorIdx[i] = this.getColorIndex('#ffcc00');
                else if (lifeRatio > 0.2) this.colorIdx[i] = this.getColorIndex('#ff4400');
                else this.colorIdx[i] = this.getColorIndex('#333');
            } else if (this.type[i] === ParticleType.MOLTEN) {
                if (this.z[i] >= 0) {
                    const moltenLifeRatio = this.life[i] / 7.0;
                    if (moltenLifeRatio > 0.6) this.colorIdx[i] = this.getColorIndex('#ffff00');
                    else if (moltenLifeRatio > 0.3) this.colorIdx[i] = this.getColorIndex('#ffaa00');
                    else if (moltenLifeRatio > 0.1) this.colorIdx[i] = this.getColorIndex('#ff4400');
                    else this.colorIdx[i] = this.getColorIndex('#222');
                }
            }
        }
    }

    private processWorkerEvents(player: Entity | null, enemies: Entity[], world: World | null): void {
        // ... (existing code)
    }

    private updateMainThread(dt: number, world: World | null, player: Entity | null, enemies: Entity[]): void {
        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (!(this.flags[i] & FLAG_ACTIVE)) continue;

            this.prevX[i] = this.x[i];
            this.prevY[i] = this.y[i];
            this.prevZ[i] = this.z[i];

            const pType = this.type[i];
            
            if (pType === ParticleType.STANDARD || pType === ParticleType.MOLTEN) {
                const nextX = this.x[i] + this.vx[i] * dt;
                const nextY = this.y[i] + this.vy[i] * dt;
                const isFlame = this.flags[i] & FLAG_IS_FLAME;
                
                if (world && world.isWall(nextX, nextY)) {
                    if (isFlame) {
                        this.vx[i] = 0; this.vy[i] = 0; this.life[i] *= 0.5;
                    } else if (pType === ParticleType.MOLTEN) {
                        this.vx[i] *= -0.3; this.vy[i] *= -0.3;
                    }
                } else {
                    this.x[i] = nextX;
                    this.y[i] = nextY;
                }

                if (pType === ParticleType.MOLTEN) {
                    this.vz[i] += 80 * dt;
                    this.z[i] += this.vz[i] * dt;
                    this.vx[i] *= 0.995; this.vy[i] *= 0.995;

                    if (this.z[i] > 0 && this.vz[i] > 0) {
                        if (this.z[i] !== 0 && (world as any)?.heatMap) {
                            (world as any).heatMap.addHeat(this.x[i], this.y[i], 0.6, 20);
                        }
                        this.z[i] = 0; this.vz[i] = 0; this.vx[i] = 0; this.vy[i] = 0;
                    }

                    if (this.z[i] < -2) {
                        const targets = player ? [player, ...enemies] : enemies;
                        for (const t of targets) {
                            if (t && t.active) {
                                const dx = t.x - this.x[i];
                                const dy = t.y - this.y[i];
                                const rSum = t.radius + this.radius[i];
                                if (dx * dx + dy * dy < rSum * rSum) {
                                    t.takeDamage(5);
                                    this.flags[i] &= ~FLAG_ACTIVE;
                                    break;
                                }
                            }
                        }
                    }
                } else {
                    this.vx[i] *= 0.95; this.vy[i] *= 0.95;
                }
            }

            this.life[i] -= dt;
            if (this.life[i] <= 0) this.flags[i] &= ~FLAG_ACTIVE;
        }
    }

    public render(ctx: CanvasRenderingContext2D): void {
        const alpha = (Entity as any).interpolationAlpha || 0;
        
        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (!(this.flags[i] & FLAG_ACTIVE)) continue;

            const ix = this.prevX[i] + (this.x[i] - this.prevX[i]) * alpha;
            const iy = this.prevY[i] + (this.y[i] - this.prevY[i]) * alpha;
            const iz = this.prevZ[i] + (this.z[i] - this.prevZ[i]) * alpha;
            
            const pType = this.type[i];
            const color = this.colorPalette[this.colorIdx[i]];
            const lifeRatio = this.life[i] / this.maxLife[i];

            ctx.save();
            if (pType === ParticleType.STANDARD) {
                ctx.globalAlpha = Math.max(0, lifeRatio);
                ctx.fillStyle = color;
                if (this.flags[i] & FLAG_IS_FLAME) {
                    ctx.globalCompositeOperation = lifeRatio > 0.4 ? 'screen' : 'source-over';
                    const grad = ctx.createRadialGradient(ix, iy, 0, ix, iy, this.radius[i]);
                    grad.addColorStop(0, color);
                    grad.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = grad;
                }
                ctx.beginPath();
                ctx.arc(ix, iy, this.radius[i], 0, Math.PI * 2);
                ctx.fill();
            } 
            else if (pType === ParticleType.SHOCKWAVE) {
                const ratio = 1 - lifeRatio;
                const currentRadius = this.radius[i] * Math.pow(ratio, 0.5);
                ctx.globalAlpha = Math.max(0, 1 - ratio);
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(ix, iy, currentRadius, 0, Math.PI * 2);
                ctx.stroke();
            }
            else if (pType === ParticleType.FLASH) {
                ctx.globalCompositeOperation = 'screen';
                const grad = ctx.createRadialGradient(ix, iy, 0, ix, iy, this.radius[i]);
                grad.addColorStop(0, `rgba(255, 255, 255, 1.0)`);
                grad.addColorStop(0.3, `rgba(255, 255, 200, ${lifeRatio})`);
                grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(ix, iy, this.radius[i], 0, Math.PI * 2);
                ctx.fill();
            }
            else if (pType === ParticleType.MOLTEN) {
                const ry = iy + iz;
                ctx.globalCompositeOperation = 'screen';
                const glowRadius = this.radius[i] * (iz < 0 ? 6 : 4);
                const grad = ctx.createRadialGradient(ix, ry, 0, ix, ry, glowRadius);
                const mAlpha = iz < 0 ? 0.9 : (this.life[i] / 7.0) * 0.9;
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(0.2, '#ffff00');
                grad.addColorStop(0.5, color);
                grad.addColorStop(1, 'rgba(255, 100, 0, 0)');
                ctx.fillStyle = grad;
                ctx.globalAlpha = Math.max(0, mAlpha);
                ctx.beginPath();
                ctx.arc(ix, ry, glowRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.globalAlpha = 1.0;
                ctx.beginPath();
                ctx.arc(ix, ry, this.radius[i] * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    }

    public getParticles(): any[] {
        const active = [];
        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (this.flags[i] & FLAG_ACTIVE) {
                active.push({
                    x: this.x[i], y: this.y[i], z: this.z[i],
                    vx: this.vx[i], vy: this.vy[i], vz: this.vz[i],
                    life: this.life[i],
                    color: this.colorPalette[this.colorIdx[i]],
                    id: `p_${i}`
                });
            }
        }
        return active;
    }

    public clear(): void {
        this.flags.fill(0);
    }
}
