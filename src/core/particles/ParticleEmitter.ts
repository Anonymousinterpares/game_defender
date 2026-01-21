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
        if (ConfigManager.getInstance().get<boolean>('Visuals', 'enableSmoke') && world) {
            this.smokeInterval += dt;
            if (this.smokeInterval > 0.05) { // 20 times per second
                this.smokeInterval = 0;
                this.emitHeatSmoke(world);
                this.emitEntitySmoke(player, enemies);
            }
        }
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

    public spawnSmoke(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string): number {
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

    private emitHeatSmoke(world: World): void {
        const heatMap = world.getHeatMap();
        if (!heatMap) return;
        const activeTiles = heatMap.activeTiles;
        const tileSize = world.getTileSize();
        const ps = (window as any).ParticleSystemInstance || (this as any)._ps || (world as any).particleSystem;
        // Note: The project uses ParticleSystem.getInstance()
        // Importing it here might cause circularity, let's use the singleton directly if it's available.
        // Actually, let's assume ParticleSystem.getInstance() is safe to use.

        const ParticleSystemClass = (this.constructor as any).ParticleSystemRef;

        activeTiles.forEach((key: string) => {
            const summary = heatMap.getTileSummary(key);
            if (!summary) return;

            const [tx, ty] = key.split(',').map(Number);
            const centerX = tx * tileSize + tileSize / 2;
            const centerY = ty * tileSize + tileSize / 2;

            // 1. DENSE FIRE SMOKE (Major Tile Level)
            if (summary.burningCount > 0) {
                const fireIntensity = summary.burningCount / 100; // 10x10 subDiv
                const ppm = ConfigManager.getInstance().getPixelsPerMeter();

                if (Math.random() < fireIntensity * 0.9 + 0.3) {
                    const count = 1 + Math.floor(fireIntensity * 4);
                    for (let i = 0; i < count; i++) {
                        const offset = (Math.random() - 0.5) * tileSize;
                        const life = 3.0 + Math.random() * 2.0;
                        const size = (tileSize * 2.5) + (fireIntensity * tileSize * 2.5);

                        // Use the globally accessible ParticleSystem if possible to ensure GPU redirection
                        const target = (globalThis as any).ParticleSystem?.getInstance();
                        const vx = (Math.random() - 0.5) * 5 * ppm; // 5m/s spread
                        const vy = (-5 - Math.random() * 8) * ppm;  // 5-13m/s rise

                        if (target) {
                            target.spawnSmoke(centerX + offset, centerY + offset, vx, vy, life, size, '#000');
                        } else {
                            this.spawnSmoke(centerX + offset, centerY + offset, vx, vy, life, size, '#000');
                        }
                    }
                }
            }

            // 2. RESIDUE HEAT SMOKE (Smaller/Lighter)
            if (summary.maxHeat > 0.4 && Math.random() < summary.avgHeat * 0.4) {
                const ppm = ConfigManager.getInstance().getPixelsPerMeter();
                const target = (globalThis as any).ParticleSystem?.getInstance();
                const vx = (Math.random() - 0.5) * 2 * ppm;
                const vy = (-2 - Math.random() * 3) * ppm;

                if (target) {
                    target.spawnSmoke(centerX + (Math.random() - 0.5) * tileSize, centerY + (Math.random() - 0.5) * tileSize, vx, vy, 2.0, tileSize * 1.2, '#666');
                } else {
                    this.spawnSmoke(centerX + (Math.random() - 0.5) * tileSize, centerY + (Math.random() - 0.5) * tileSize, vx, vy, 2.0, tileSize * 1.2, '#666');
                }
            }
        });
    }

    private emitEntitySmoke(player: ParticleTarget | null, enemies: ParticleTarget[]): void {
        const targets = player ? [player, ...enemies] : enemies;
        const targetPS = (globalThis as any).ParticleSystem?.getInstance();

        targets.forEach(t => {
            if (t.active && (t as any).isOnFire) {
                // Persistent dense smoke trailing from burning characters
                for (let i = 0; i < 2; i++) {
                    const wx = t.x + (Math.random() - 0.5) * t.radius;
                    const wy = t.y + (Math.random() - 0.5) * t.radius;
                    if (targetPS) {
                        targetPS.spawnSmoke(wx, wy, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 1.5 + Math.random(), 18 + Math.random() * 12, '#000');
                    } else {
                        this.spawnSmoke(wx, wy, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 1.5 + Math.random(), 18 + Math.random() * 12, '#000');
                    }
                }
            }
        });
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
