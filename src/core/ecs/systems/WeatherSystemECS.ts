import { System } from '../System';
import { EntityManager } from '../EntityManager';
import { WeatherManager, WeatherType } from '../../WeatherManager';
import { EventBus, GameEvent } from '../../EventBus';
import { ConfigManager } from '../../../config/MasterConfig';

export interface WeatherParticle {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    wasRepulsed: boolean;
    repulsionLife: number;
}

export interface RepulsionZone {
    x: number;
    y: number;
    radius: number;
    strength: number;
    life: number;
    maxLife: number;
}

export class WeatherSystemECS implements System {
    public readonly id = 'weather_system_ecs';

    private particles: WeatherParticle[] = [];
    private repulsionZones: RepulsionZone[] = [];
    private maxParticles: number = 1000;

    private cameraX: number = 0;
    private cameraY: number = 0;
    private viewWidth: number = 1920;
    private viewHeight: number = 1080;

    private splashQueue: Array<{ x: number, y: number, type: string }> = [];

    constructor() {
        this.initParticles();
        this.subscribeToEvents();
    }

    public setCamera(x: number, y: number, w: number, h: number): void {
        this.cameraX = x;
        this.cameraY = y;
        this.viewWidth = w;
        this.viewHeight = h;
    }

    private initParticles(): void {
        for (let i = 0; i < this.maxParticles; i++) {
            this.particles.push({
                x: Math.random() * 2000,
                y: Math.random() * 2000,
                z: Math.random() * 500,
                vx: 0, vy: 0, vz: 0,
                life: Math.random(),
                wasRepulsed: false,
                repulsionLife: 0
            });
        }
    }

    private subscribeToEvents(): void {
        EventBus.getInstance().on(GameEvent.EXPLOSION, (data) => {
            this.repulsionZones.push({
                x: data.x,
                y: data.y,
                radius: data.radius * 3.5,
                strength: 2500,
                life: 0.8,
                maxLife: 0.8
            });
        });
    }

    public update(dt: number, entityManager: EntityManager): void {
        const weather = WeatherManager.getInstance().getWeatherState();
        const ppm = ConfigManager.getInstance().getPixelsPerMeter();

        // Update Repulsion Zones
        this.repulsionZones = this.repulsionZones.filter(zone => {
            zone.life -= dt;
            return zone.life > 0;
        });

        if (weather.precipitationIntensity < 0.05) return;

        const windX = weather.windDir.x * weather.windSpeed * ppm;
        const windY = weather.windDir.y * weather.windSpeed * ppm;
        const isRain = weather.type === WeatherType.RAIN;

        // Bounds for wrapping (relative to camera)
        const margin = 200;
        const minX = this.cameraX - margin;
        const maxX = this.cameraX + this.viewWidth + margin;
        const minY = this.cameraY - margin;
        const maxY = this.cameraY + this.viewHeight + margin;

        this.particles.forEach(p => {
            if (isRain) {
                p.vz = -10 * ppm; // ~10 m/s fall
                p.vx = (p.vx * 0.95) + windX * 0.05;
                p.vy = (p.vy * 0.95) + windY * 0.05;
            } else {
                p.vz = (-1.5 - Math.random() * 1.0) * ppm; // ~1.5 m/s fall
                const sway = Math.sin(Date.now() * 0.002 + p.life * 10) * 5 * ppm; // ~5 m/s sway
                p.vx = (p.vx * 0.95) + (windX + sway) * 0.05;
                p.vy = (p.vy * 0.95) + windY * 0.05;
            }

            const metersPerTile = ConfigManager.getInstance().get<number>('World', 'metersPerTile');
            // Fix: Scale speed by metersPerTile so rain looks fast even when zoomed out
            const fallSpeed = isRain ? 10 * ppm * metersPerTile : 1.5 * ppm * metersPerTile;

            // Apply Repulsion
            this.repulsionZones.forEach(zone => {
                const dx = p.x - zone.x;
                const dy = p.y - zone.y;
                const distSq = dx * dx + dy * dy;
                const radSq = zone.radius * zone.radius;

                if (distSq < radSq) {
                    const dist = Math.sqrt(distSq);
                    const falloff = 1 - (dist / zone.radius);
                    const force = (falloff * falloff) * zone.strength;
                    const nx = dx / (dist || 1);
                    const ny = dy / (dist || 1);

                    const lifeMult = zone.life / zone.maxLife;
                    p.vx += nx * force * lifeMult * dt * 20;
                    p.vy += ny * force * lifeMult * dt * 20;

                    // Mark as repulsed
                    if (!p.wasRepulsed) {
                        p.wasRepulsed = true;
                        p.repulsionLife = 0;
                    }
                }
            });

            // Track repulsed particle lifetime
            if (p.wasRepulsed) {
                p.repulsionLife += dt;

                // After 0.4 seconds of being repulsed, "land" the particle
                if (p.repulsionLife >= 0.4) {
                    // Spawn splash for rain at current position
                    if (isRain) {
                        this.splashQueue.push({
                            x: p.x,
                            y: p.y,
                            type: 'rain'
                        });
                    }

                    // Reset particle
                    p.z = 400 + Math.random() * 200;
                    p.life = Math.random();
                    p.x = minX + Math.random() * (maxX - minX);
                    p.y = minY + Math.random() * (maxY - minY);
                    p.wasRepulsed = false;
                    p.repulsionLife = 0;
                    p.vx = 0;
                    p.vy = 0;
                    return; // Skip rest of physics for this particle this frame
                }
            }

            // CLAMP VERTICAL VELOCITY
            let verticalShift = p.vy;
            if (!isRain && fallSpeed + verticalShift < 30) {
                verticalShift = 30 - fallSpeed;
            }

            // Physics Update
            p.x += p.vx * dt;
            p.y += (fallSpeed + verticalShift) * dt;
            p.z += p.vz * dt;

            // Reset Z
            if (p.z <= 0) {
                p.z = 400 + Math.random() * 200;
                p.life = Math.random();
                // Randomize position slightly upon respawn to avoid patterns
                p.x = minX + Math.random() * (maxX - minX);
                p.y = minY + Math.random() * (maxY - minY);
                p.wasRepulsed = false;
                p.repulsionLife = 0;
            }

            // World Wrapping (Toroidal around camera)
            if (p.x < minX) p.x += (maxX - minX);
            else if (p.x > maxX) p.x -= (maxX - minX);

            if (p.y < minY) p.y += (maxY - minY);
            else if (p.y > maxY) p.y -= (maxY - minY);
        });
    }

    public getParticles(): WeatherParticle[] {
        return this.particles;
    }

    public getSplashes(): Array<{ x: number, y: number, type: string }> {
        const splashes = [...this.splashQueue];
        this.splashQueue = [];
        return splashes;
    }
}
