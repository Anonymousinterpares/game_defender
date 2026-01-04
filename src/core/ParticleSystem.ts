import { Entity } from './Entity';
import { Particle, ShockwaveParticle, FlashParticle, MoltenMetalParticle } from '../entities/Particle';
import { World } from './World';

export class ParticleSystem {
    private static instance: ParticleSystem;
    
    private particles: Entity[] = [];
    
    // Pools
    private particlePool: Particle[] = [];
    private shockwavePool: ShockwaveParticle[] = [];
    private flashPool: FlashParticle[] = [];
    private moltenPool: MoltenMetalParticle[] = [];

    private constructor() {}

    public static getInstance(): ParticleSystem {
        if (!ParticleSystem.instance) {
            ParticleSystem.instance = new ParticleSystem();
        }
        return ParticleSystem.instance;
    }

    public spawnParticle(x: number, y: number, color: string, vx: number, vy: number, life: number = 0.5): Particle {
        let p: Particle;
        if (this.particlePool.length > 0) {
            p = this.particlePool.pop()!;
            p.reset(x, y, color, vx, vy, life);
        } else {
            p = new Particle(x, y, color, vx, vy, life);
        }
        this.particles.push(p);
        return p;
    }

    public spawnShockwave(x: number, y: number, radius: number): ShockwaveParticle {
        let p: ShockwaveParticle;
        if (this.shockwavePool.length > 0) {
            p = this.shockwavePool.pop()!;
            p.reset(x, y, radius);
        } else {
            p = new ShockwaveParticle(x, y, radius);
        }
        this.particles.push(p);
        return p;
    }

    public spawnFlash(x: number, y: number, radius: number): FlashParticle {
        let p: FlashParticle;
        if (this.flashPool.length > 0) {
            p = this.flashPool.pop()!;
            p.reset(x, y, radius);
        } else {
            p = new FlashParticle(x, y, radius);
        }
        this.particles.push(p);
        return p;
    }

    public spawnMoltenMetal(x: number, y: number, vx: number, vy: number): MoltenMetalParticle {
        let p: MoltenMetalParticle;
        if (this.moltenPool.length > 0) {
            p = this.moltenPool.pop()!;
            p.reset(x, y, vx, vy);
        } else {
            p = new MoltenMetalParticle(x, y, vx, vy);
        }
        this.particles.push(p);
        return p;
    }

    public update(dt: number, world: World | null, player: Entity | null, enemies: Entity[]): void {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.update(dt, world);

            // Special logic for MoltenMetalParticle collision (ported from GameplayScene)
            if (p.active && p instanceof MoltenMetalParticle && p.z < -2) {
                const targets = player ? [player, ...enemies] : enemies;
                for (const t of targets) {
                    if (t && t.active) {
                        const dx = t.x - p.x;
                        const dy = t.y - p.y;
                        if (dx * dx + dy * dy < (t.radius + p.radius) ** 2) {
                            t.takeDamage(p.damage);
                            p.active = false;
                            break;
                        }
                    }
                }
            }

            if (!p.active) {
                this.particles.splice(i, 1);
                this.releaseToPool(p);
            }
        }
    }

    private releaseToPool(p: Entity): void {
        if (p instanceof MoltenMetalParticle) this.moltenPool.push(p);
        else if (p instanceof FlashParticle) this.flashPool.push(p);
        else if (p instanceof ShockwaveParticle) this.shockwavePool.push(p);
        else if (p instanceof Particle) this.particlePool.push(p);
    }

    public render(ctx: CanvasRenderingContext2D): void {
        for (const p of this.particles) {
            p.render(ctx);
        }
    }

    public getParticles(): Entity[] {
        return this.particles;
    }

    public clear(): void {
        this.particles = [];
        // Optionally keep pools for reuse across scene changes
    }
}
