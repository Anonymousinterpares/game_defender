import { ParticleData, ParticleTarget } from './ParticleData';
import { ParticleType, FLAG_ACTIVE, FLAG_IS_FLAME, MAX_PARTICLES } from '../ParticleConstants';

export interface WorldCollision {
    isWall(x: number, y: number): boolean;
}

export interface SimulationEvents {
    damageEvents: { targetIdx: number, damage: number }[];
    heatEvents: { x: number, y: number, intensity: number, radius: number }[];
}

export class ParticleSimulation {

    /**
     * Updates all particles. Designed to be stateless regarding the world, accepting callbacks/interfaces.
     * Returns events generated during simulation (collisions, heat).
     */
    public static update(
        dt: number,
        data: ParticleData,
        world: WorldCollision,
        player: ParticleTarget | null,
        enemies: ParticleTarget[],
        weather: any,
        isHost: boolean
    ): SimulationEvents {

        const damageEvents: { targetIdx: number, damage: number }[] = [];
        const heatEvents: { x: number, y: number, intensity: number, radius: number }[] = [];

        const windX = weather ? weather.windDir.x * weather.windSpeed : 0;
        const windY = weather ? weather.windDir.y * weather.windSpeed : 0;

        // Use a loop bound by MAX_PARTICLES, or data.activeCount if maintainable?
        // Worker uses full loop. Optimization: Use activeIndices if available?
        // But activeIndices is not maintained in Worker normally. 
        // For consistency and shared logic, we'll iterate active flags or full array.
        // The worker iterates 0..MAX_PARTICLES and checks flags. We will do the same.

        const count = MAX_PARTICLES;

        for (let i = 0; i < count; i++) {
            if (!(data.flags[i] & FLAG_ACTIVE)) continue;

            data.prevX[i] = data.x[i];
            data.prevY[i] = data.y[i];
            data.prevZ[i] = data.z[i];

            const pType = data.type[i];

            if (pType === ParticleType.SMOKE) {
                // Smoke physics: Wind + Drift + Turbulence
                const driftY = -15; // Rising heat
                // We use i as a random seed offset for turbulence
                const time = Date.now() * 0.001 + i;
                // Note: Date.now() in worker might differ slightly but physics simulation usually uses passed time or frame count.
                // However, the original code used Date.now(). In a deterministic sim, we should pass 'time' as argument.
                // For visual smoke, it's fine.

                const turbX = Math.sin(time * 2) * 10;
                const turbY = Math.cos(time * 1.5) * 5;

                data.vx[i] += (windX * 20 + turbX - data.vx[i] * 0.5) * dt;
                data.vy[i] += (windY * 20 + driftY + turbY - data.vy[i] * 0.5) * dt;

                data.x[i] += data.vx[i] * dt;
                data.y[i] += data.vy[i] * dt;

                // Expand smoke
                const lifeRatio = data.life[i] / data.maxLife[i];
                data.radius[i] = data.startRadius[i] + (1.0 - lifeRatio) * (data.startRadius[i] * 2);
            }
            else if (pType === ParticleType.STANDARD || pType === ParticleType.MOLTEN) {
                const nextX = data.x[i] + data.vx[i] * dt;
                const nextY = data.y[i] + data.vy[i] * dt;
                const isFlame = data.flags[i] & FLAG_IS_FLAME;

                // Check Wall Collision
                const wallCollision = world.isWall(nextX, nextY);

                if (isFlame && wallCollision) {
                    data.vx[i] = 0;
                    data.vy[i] = 0;
                    data.life[i] *= 0.5;
                } else if (pType === ParticleType.MOLTEN && wallCollision) {
                    data.vx[i] *= -0.3;
                    data.vy[i] *= -0.3;
                } else {
                    data.x[i] = nextX;
                    data.y[i] = nextY;
                }

                if (pType === ParticleType.MOLTEN) {
                    const gravity = 80;
                    data.vz[i] += gravity * dt;
                    data.z[i] += data.vz[i] * dt;

                    data.vx[i] *= 0.995;
                    data.vy[i] *= 0.995;

                    // Ground collision (z=0)
                    if (data.z[i] > 0 && data.vz[i] > 0) {
                        if (data.z[i] !== 0 && isHost) {
                            heatEvents.push({ x: data.x[i], y: data.y[i], intensity: 0.6, radius: 20 });
                        }
                        data.z[i] = 0;
                        data.vz[i] = 0;
                        data.vx[i] = 0;
                        data.vy[i] = 0;
                    }

                    // Entity collision (z < -2, somewhat above ground/flying checks?)
                    // Original code: if (this.z[i] < -2)
                    if (data.z[i] < -2) {
                        // Check collision with player
                        if (player && player.active) {
                            const dx = player.x - data.x[i];
                            const dy = player.y - data.y[i];
                            const rSum = player.radius + data.radius[i];
                            if (dx * dx + dy * dy < rSum * rSum) {
                                damageEvents.push({ targetIdx: -1, damage: 5 }); // -1 for player
                                data.flags[i] &= ~FLAG_ACTIVE;
                            }
                        }
                        // Check enemies
                        if (data.flags[i] & FLAG_ACTIVE) {
                            for (let j = 0; j < enemies.length; j++) {
                                const e = enemies[j];
                                const dx = e.x - data.x[i];
                                const dy = e.y - data.y[i];
                                const rSum = e.radius + data.radius[i];
                                if (dx * dx + dy * dy < rSum * rSum) {
                                    damageEvents.push({ targetIdx: j, damage: 5 });
                                    data.flags[i] &= ~FLAG_ACTIVE;
                                    break;
                                }
                            }
                        }
                    }
                } else {
                    data.vx[i] *= 0.95;
                    data.vy[i] *= 0.95;
                }
            }

            data.life[i] -= dt;
            if (data.life[i] <= 0) {
                data.flags[i] &= ~FLAG_ACTIVE;
            }

            // Visual state updates (Radius for flames)
            if (data.flags[i] & FLAG_ACTIVE) {
                const lifeRatio = data.life[i] / data.maxLife[i];
                if (data.flags[i] & FLAG_IS_FLAME) {
                    data.radius[i] = data.startRadius[i] + (1 - lifeRatio) * 10;
                }
            }
        }

        return { damageEvents, heatEvents };
    }
}
