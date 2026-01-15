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

    constructor() {
        this.initParticles();
        this.subscribeToEvents();
    }

    private initParticles(): void {
        for (let i = 0; i < this.maxParticles; i++) {
            this.particles.push({
                x: Math.random() * 2000,
                y: Math.random() * 2000,
                z: Math.random() * 500,
                vx: 0, vy: 0, vz: 0,
                life: Math.random()
            });
        }
    }

    private subscribeToEvents(): void {
        EventBus.getInstance().on(GameEvent.EXPLOSION, (data) => {
            this.repulsionZones.push({
                x: data.x,
                y: data.y,
                radius: data.radius * 2.5, // Repulsion reaches further than damage
                strength: 1500, // Initial push strength
                life: 0.3, // Duration of the repulsion force
                maxLife: 0.3
            });
        });
    }

    public update(dt: number, entityManager: EntityManager): void {
        const weather = WeatherManager.getInstance().getWeatherState();

        // Update Repulsion Zones
        this.repulsionZones = this.repulsionZones.filter(zone => {
            zone.life -= dt;
            return zone.life > 0;
        });

        if (weather.precipitationIntensity < 0.05) return;

        const windX = weather.windDir.x * weather.windSpeed * 50;
        const windY = weather.windDir.y * weather.windSpeed * 50;
        const isRain = weather.type === WeatherType.RAIN;

        // Use a virtual viewport for screen wrapping based on player position (roughly)
        // Since we don't have camera here easily without passing it, and systems shouldn't know about camera,
        // we use a large world-space wrapping or just rely on the renderer to handle wrapping/parallax visuals.
        // Actually, LightingRenderer uses % w/h for wrapping, so we just update world coordinates.

        const w = 2000; // Reference width for wrapping (should ideally match renderer viewport or be large enough)
        const h = 2000; // Reference height

        this.particles.forEach(p => {
            if (isRain) {
                p.vz = -500;
                p.vx = windX;
                p.vy = windY;
            } else {
                p.vz = -100 - Math.random() * 50;
                const sway = Math.sin(Date.now() * 0.002 + p.life * 10) * 30;
                p.vx = windX + sway;
                p.vy = windY;
            }

            const fallSpeed = isRain ? 500 : 120;
            const finalVy = fallSpeed + Math.max(-200, p.vy);

            // Apply Repulsion
            this.repulsionZones.forEach(zone => {
                const dx = p.x - zone.x;
                const dy = p.y - zone.y;
                const distSq = dx * dx + dy * dy;
                const radSq = zone.radius * zone.radius;

                if (distSq < radSq) {
                    const dist = Math.sqrt(distSq);
                    const force = (1 - dist / zone.radius) * zone.strength * (zone.life / zone.maxLife);
                    const nx = dx / (dist || 1);
                    const ny = dy / (dist || 1);

                    p.vx += nx * force;
                    p.vy += ny * force;
                }
            });

            p.x += p.vx * dt;
            p.y += (finalVy + p.vy) * dt; // Vy is additive to fall speed when repelled
            p.z += p.vz * dt;

            // Reset particle if it hits ground or goes too far
            if (p.z <= 0) {
                p.z = 400 + Math.random() * 200;
                p.life = Math.random();
            }
        });
    }

    public getParticles(): WeatherParticle[] {
        return this.particles;
    }
}
