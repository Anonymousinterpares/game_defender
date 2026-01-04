import { Entity } from './Entity';
import { World } from './World';
import { MaterialType } from './HeatMap';

export enum ParticleType {
    STANDARD = 0,
    SHOCKWAVE = 1,
    FLASH = 2,
    MOLTEN = 3
}

// Bitwise flags for particle state
const FLAG_ACTIVE = 1 << 0;
const FLAG_IS_FLAME = 1 << 1;

export class ParticleSystem {
    private static instance: ParticleSystem;
    private readonly MAX_PARTICLES = 10000;
    
    // SoA (Structure of Arrays)
    // Using a single buffer for better cache locality, or separate ones for easier worker transfer.
    // We'll use separate ones for now to simplify logic.
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
    private colorIdx: Uint32Array; // Storing color as packed ARGB or palette index

    private colorPalette: string[] = [];
    private nextFreeIdx: number = 0;
    private activeCount: number = 0;

    private constructor() {
        this.x = new Float32Array(this.MAX_PARTICLES);
        this.y = new Float32Array(this.MAX_PARTICLES);
        this.z = new Float32Array(this.MAX_PARTICLES);
        this.prevX = new Float32Array(this.MAX_PARTICLES);
        this.prevY = new Float32Array(this.MAX_PARTICLES);
        this.prevZ = new Float32Array(this.MAX_PARTICLES);
        this.vx = new Float32Array(this.MAX_PARTICLES);
        this.vy = new Float32Array(this.MAX_PARTICLES);
        this.vz = new Float32Array(this.MAX_PARTICLES);
        this.life = new Float32Array(this.MAX_PARTICLES);
        this.maxLife = new Float32Array(this.MAX_PARTICLES);
        this.radius = new Float32Array(this.MAX_PARTICLES);
        this.startRadius = new Float32Array(this.MAX_PARTICLES);
        this.type = new Uint8Array(this.MAX_PARTICLES);
        this.flags = new Uint8Array(this.MAX_PARTICLES);
        this.colorIdx = new Uint32Array(this.MAX_PARTICLES);
    }

    public static getInstance(): ParticleSystem {
        if (!ParticleSystem.instance) {
            ParticleSystem.instance = new ParticleSystem();
        }
        return ParticleSystem.instance;
    }

    private getNextIndex(): number {
        // Simple linear search for free slot. In a high-perf system, 
        // we'd use a free-list or a more advanced allocator.
        for (let i = 0; i < this.MAX_PARTICLES; i++) {
            const idx = (this.nextFreeIdx + i) % this.MAX_PARTICLES;
            if (!(this.flags[idx] & FLAG_ACTIVE)) {
                this.nextFreeIdx = (idx + 1) % this.MAX_PARTICLES;
                return idx;
            }
        }
        return -1; // Pool full
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
        this.flags[i] = FLAG_ACTIVE;
        this.colorIdx[i] = this.getColorIndex(color);
        
        return i;
    }

    public spawnShockwave(x: number, y: number, radius: number): number {
        const i = this.getNextIndex();
        if (i === -1) return -1;

        this.x[i] = x; this.y[i] = y; this.z[i] = 0;
        this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = 0;
        this.vx[i] = 0; this.vy[i] = 0; this.vz[i] = 0;
        this.life[i] = 0.4; this.maxLife[i] = 0.4;
        this.radius[i] = radius; // For shockwave, radius is maxRadius
        this.type[i] = ParticleType.SHOCKWAVE;
        this.flags[i] = FLAG_ACTIVE;
        this.colorIdx[i] = this.getColorIndex('#fff');
        
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
        this.flags[i] = FLAG_ACTIVE;
        this.colorIdx[i] = this.getColorIndex('#fff');
        
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
        this.flags[i] = FLAG_ACTIVE;
        this.colorIdx[i] = this.getColorIndex('#ffff00');
        
        return i;
    }

    public setFlame(idx: number, isFlame: boolean): void {
        if (idx === -1) return;
        if (isFlame) this.flags[idx] |= FLAG_IS_FLAME;
        else this.flags[idx] &= ~FLAG_IS_FLAME;
    }

    public update(dt: number, world: World | null, player: Entity | null, enemies: Entity[]): void {
        const alpha = (Entity as any).interpolationAlpha || 0;
        
        for (let i = 0; i < this.MAX_PARTICLES; i++) {
            if (!(this.flags[i] & FLAG_ACTIVE)) continue;

            this.prevX[i] = this.x[i];
            this.prevY[i] = this.y[i];
            this.prevZ[i] = this.z[i];

            const pType = this.type[i];
            
            if (pType === ParticleType.STANDARD || pType === ParticleType.MOLTEN) {
                const nextX = this.x[i] + this.vx[i] * dt;
                const nextY = this.y[i] + this.vy[i] * dt;

                const isFlame = this.flags[i] & FLAG_IS_FLAME;
                
                if (isFlame && world && world.isWall(nextX, nextY)) {
                    this.vx[i] = 0;
                    this.vy[i] = 0;
                    this.life[i] *= 0.5;
                } else if (pType === ParticleType.MOLTEN && world && world.isWall(nextX, nextY)) {
                    this.vx[i] *= -0.3;
                    this.vy[i] *= -0.3;
                } else {
                    this.x[i] = nextX;
                    this.y[i] = nextY;
                }

                if (pType === ParticleType.MOLTEN) {
                    const gravity = 80;
                    this.vz[i] += gravity * dt;
                    this.z[i] += this.vz[i] * dt;

                    // Friction
                    this.vx[i] *= 0.995;
                    this.vy[i] *= 0.995;

                    if (this.z[i] > 0 && this.vz[i] > 0) {
                        if (this.z[i] !== 0 && world && (world as any).heatMap) {
                            (world as any).heatMap.addHeat(this.x[i], this.y[i], 0.6, 20);
                        }
                        this.z[i] = 0;
                        this.vz[i] = 0;
                        this.vx[i] = 0;
                        this.vy[i] = 0;
                    }

                    // Damage logic
                    if (this.z[i] < -2) {
                        const targets = player ? [player, ...enemies] : enemies;
                        for (const t of targets) {
                            if (t && t.active) {
                                const dx = t.x - this.x[i];
                                const dy = t.y - this.y[i];
                                const rSum = t.radius + this.radius[i];
                                if (dx * dx + dy * dy < rSum * rSum) {
                                    t.takeDamage(5); // Damage value
                                    this.flags[i] &= ~FLAG_ACTIVE;
                                    break;
                                }
                            }
                        }
                    }
                } else {
                    // Standard particle friction
                    this.vx[i] *= 0.95;
                    this.vy[i] *= 0.95;
                }
            }

            this.life[i] -= dt;
            if (this.life[i] <= 0) {
                this.flags[i] &= ~FLAG_ACTIVE;
            }

            // Update visuals based on life
            if (this.flags[i] & FLAG_ACTIVE) {
                const lifeRatio = this.life[i] / this.maxLife[i];
                if (this.flags[i] & FLAG_IS_FLAME) {
                    this.radius[i] = this.startRadius[i] + (1 - lifeRatio) * 10;
                    if (lifeRatio > 0.7) this.colorIdx[i] = this.getColorIndex('#fffbe6');
                    else if (lifeRatio > 0.4) this.colorIdx[i] = this.getColorIndex('#ffcc00');
                    else if (lifeRatio > 0.2) this.colorIdx[i] = this.getColorIndex('#ff4400');
                    else this.colorIdx[i] = this.getColorIndex('#333');
                } else if (pType === ParticleType.MOLTEN) {
                    if (this.z[i] < 0) {
                        this.colorIdx[i] = this.getColorIndex('#fffbe6');
                    } else {
                        const moltenLifeRatio = this.life[i] / 7.0;
                        if (moltenLifeRatio > 0.6) this.colorIdx[i] = this.getColorIndex('#ffff00');
                        else if (moltenLifeRatio > 0.3) this.colorIdx[i] = this.getColorIndex('#ffaa00');
                        else if (moltenLifeRatio > 0.1) this.colorIdx[i] = this.getColorIndex('#ff4400');
                        else this.colorIdx[i] = this.getColorIndex('#222');
                    }
                }
            }
        }
    }

    public render(ctx: CanvasRenderingContext2D): void {
        const alpha = (Entity as any).interpolationAlpha || 0;
        
        for (let i = 0; i < this.MAX_PARTICLES; i++) {
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
        // This is a compatibility shim for LightManager and other systems
        // that expect an array of objects. We should refactor them next.
        const active = [];
        for (let i = 0; i < this.MAX_PARTICLES; i++) {
            if (this.flags[i] & FLAG_ACTIVE) {
                active.push({
                    x: this.x[i],
                    y: this.y[i],
                    z: this.z[i],
                    vx: this.vx[i],
                    vy: this.vy[i],
                    vz: this.vz[i],
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
        this.activeCount = 0;
    }
}