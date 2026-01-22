import { ParticleData, ParticleTarget } from './ParticleData';
import { ParticleType, FLAG_ACTIVE, FLAG_IS_FLAME, MAX_PARTICLES } from '../ParticleConstants';
import { ConfigManager } from '../../config/MasterConfig';
import { World } from '../World';

export class ParticleEmitter {
    private data: ParticleData;
    private smokeInterval: number = 0;

    constructor(data: ParticleData) {
        this.data = data;
    }

    private getNextIndex(): number {
        for (let i = 0; i < MAX_PARTICLES; i++) {
            const idx = (this.data.nextFreeIdx + i) % MAX_PARTICLES;
            if (!(this.data.flags[idx] & FLAG_ACTIVE)) {
                this.data.nextFreeIdx = (idx + 1) % MAX_PARTICLES;
                return idx;
            }
        }
        return -1;
    }

    private getColorIndex(color: string): number {
        let idx = this.data.colorPalette.indexOf(color);
        if (idx === -1) {
            idx = this.data.colorPalette.length;
            this.data.colorPalette.push(color);
        }
        return idx;
    }

    public update(dt: number, world: World | null, player: ParticleTarget | null, enemies: ParticleTarget[]): void {
        // No-op: Emitter is now purely passive.
        // Logic moved to ParticleSystem.
    }

    public spawnParticle(x: number, y: number, color: string, vx: number, vy: number, life: number = 0.5): number {
        const i = this.getNextIndex();
        if (i === -1) return -1;

        const ppm = ConfigManager.getInstance().getPixelsPerMeter();
        const d = this.data;
        d.x[i] = x; d.y[i] = y; d.z[i] = 0;
        d.prevX[i] = x; d.prevY[i] = y; d.prevZ[i] = 0;
        d.vx[i] = vx; d.vy[i] = vy; d.vz[i] = 0;
        d.life[i] = life; d.maxLife[i] = life;
        d.radius[i] = (0.1 + Math.random() * 0.2) * ppm; // 0.1m - 0.3m
        d.startRadius[i] = d.radius[i];
        d.type[i] = ParticleType.STANDARD;
        d.colorIdx[i] = this.getColorIndex(color);
        d.flags[i] = FLAG_ACTIVE;
        return i;
    }

    public spawnSmoke(x: number, y: number, vx: number, vy: number, life: number = 2.0, size: number = 32, color: string = '#777'): number {
        const i = this.getNextIndex();
        if (i === -1) return -1;

        const d = this.data;
        d.x[i] = x; d.y[i] = y; d.z[i] = 0;
        d.prevX[i] = x; d.prevY[i] = y; d.prevZ[i] = 0;
        d.vx[i] = vx; d.vy[i] = vy; d.vz[i] = 0;
        d.life[i] = life; d.maxLife[i] = life;
        d.radius[i] = size * 0.5;
        d.startRadius[i] = d.radius[i];
        d.type[i] = ParticleType.SMOKE;
        d.colorIdx[i] = this.getColorIndex(color);
        d.flags[i] = FLAG_ACTIVE;
        return i;
    }

    public spawnShockwave(x: number, y: number, radius: number): number {
        const i = this.getNextIndex();
        if (i === -1) return -1;

        const d = this.data;
        d.x[i] = x; d.y[i] = y; d.z[i] = 0;
        d.prevX[i] = x; d.prevY[i] = y; d.prevZ[i] = 0;
        d.vx[i] = 0; d.vy[i] = 0; d.vz[i] = 0;
        d.life[i] = 0.4; d.maxLife[i] = 0.4;
        d.radius[i] = radius;
        d.type[i] = ParticleType.SHOCKWAVE;
        d.colorIdx[i] = this.getColorIndex('#fff');
        d.flags[i] = FLAG_ACTIVE;
        return i;
    }

    public spawnFlash(x: number, y: number, radius: number): number {
        const i = this.getNextIndex();
        if (i === -1) return -1;

        const d = this.data;
        d.x[i] = x; d.y[i] = y; d.z[i] = 0;
        d.prevX[i] = x; d.prevY[i] = y; d.prevZ[i] = 0;
        d.vx[i] = 0; d.vy[i] = 0; d.vz[i] = 0;
        d.life[i] = 0.15; d.maxLife[i] = 0.15;
        d.radius[i] = radius;
        d.type[i] = ParticleType.FLASH;
        d.colorIdx[i] = this.getColorIndex('#fff');
        d.flags[i] = FLAG_ACTIVE;
        return i;
    }

    public spawnMoltenMetal(x: number, y: number, vx: number, vy: number): number {
        const i = this.getNextIndex();
        if (i === -1) return -1;

        const ppm = ConfigManager.getInstance().getPixelsPerMeter();
        const life = 5.0 + Math.random() * 2.0;

        const d = this.data;
        d.x[i] = x; d.y[i] = y; d.z[i] = 0;
        d.prevX[i] = x; d.prevY[i] = y; d.prevZ[i] = 0;
        d.vx[i] = vx; d.vy[i] = vy;
        // -10 to -16 m/s upward burst
        d.vz[i] = (-10 - Math.random() * 6) * ppm;
        d.life[i] = life; d.maxLife[i] = life;
        // 0.5m to 1.0m radius
        d.radius[i] = (0.5 + Math.random() * 0.5) * ppm;
        d.type[i] = ParticleType.MOLTEN;
        d.colorIdx[i] = this.getColorIndex('#ffff00');
        d.flags[i] = FLAG_ACTIVE;
        return i;
    }

    public setFlame(idx: number, isFlame: boolean): void {
        if (idx === -1) return;
        if (idx < 0 || idx >= MAX_PARTICLES) return;

        if (isFlame) this.data.flags[idx] |= FLAG_IS_FLAME;
        else this.data.flags[idx] &= ~FLAG_IS_FLAME;
    }



    public updateColorsAndPrune(): void {
        this.data.activeCount = 0;
        const d = this.data;

        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (!(d.flags[i] & FLAG_ACTIVE)) continue;

            // Track active particle for faster rendering
            d.activeIndices[d.activeCount++] = i;

            const lifeRatio = d.life[i] / d.maxLife[i];
            if (d.flags[i] & FLAG_IS_FLAME) {
                if (lifeRatio > 0.7) d.colorIdx[i] = this.getColorIndex('#fffbe6');
                else if (lifeRatio > 0.4) d.colorIdx[i] = this.getColorIndex('#ffcc00');
                else if (lifeRatio > 0.2) d.colorIdx[i] = this.getColorIndex('#ff4400');
                else d.colorIdx[i] = this.getColorIndex('#333');
            } else if (d.type[i] === ParticleType.MOLTEN) {
                if (d.z[i] >= 0) {
                    const moltenLifeRatio = d.life[i] / 7.0;
                    if (moltenLifeRatio > 0.6) d.colorIdx[i] = this.getColorIndex('#ffff00');
                    else if (moltenLifeRatio > 0.3) d.colorIdx[i] = this.getColorIndex('#ffaa00');
                    else if (moltenLifeRatio > 0.1) d.colorIdx[i] = this.getColorIndex('#ff4400');
                    else d.colorIdx[i] = this.getColorIndex('#222');
                }
            }
        }
    }
}
