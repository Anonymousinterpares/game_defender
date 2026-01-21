import { System } from "../System";
import { EntityManager } from "../EntityManager";
import { TransformComponent } from "../components/TransformComponent";
import { PhysicsComponent } from "../components/PhysicsComponent";
import { InputComponent } from "../components/InputComponent";
import { TagComponent } from "../components/TagComponent";
import { HealthComponent } from "../components/HealthComponent";
import { ConfigManager } from "../../../config/MasterConfig";
import { World } from "../../World";
import { WeatherManager, WeatherType } from "../../WeatherManager";
import { Quadtree, QuadtreeItem } from "../../../utils/Quadtree";
import { Entity } from "../../Entity"; // Import base Entity if needed for Quadtree, or define interface

interface PhysicsEntity extends QuadtreeItem {
    id: string;
    // QuadtreeItem has x, y, radius
}

export class PhysicsSystem implements System {
    public readonly id = 'physics';

    private accumulator: number = 0;
    private readonly fixedTimeStep: number = 1 / 60;
    public alpha: number = 0;

    constructor(private world: World, private spatialGrid: Quadtree<Entity>) { }

    update(dt: number, entityManager: EntityManager): void {
        // Prevent "Spiral of Death"
        let frameTime = dt;
        if (frameTime > 0.25) frameTime = 0.25;

        this.accumulator += frameTime;

        while (this.accumulator >= this.fixedTimeStep) {
            this.step(this.fixedTimeStep, entityManager);
            this.accumulator -= this.fixedTimeStep;
        }

        this.alpha = this.accumulator / this.fixedTimeStep;
    }

    private step(dt: number, entityManager: EntityManager): void {
        const config = ConfigManager.getInstance();
        const turnSpeed = config.get<number>('Player', 'turnSpeed') || 3.0;
        const groundFriction = config.get<number>('Physics', 'groundFriction') || 0.1;
        const rainMult = config.get<number>('Physics', 'rainFrictionMultiplier') || 0.6;
        const snowMult = config.get<number>('Physics', 'snowFrictionMultiplier') || 0.3;
        const gravity = config.get<number>('Physics', 'gravity') || 9.81;
        const maxThrust = config.get<number>('Physics', 'maxThrust') || 2500;
        const physicsLogs = config.get<boolean>('Debug', 'physics_logs');

        // Apply weather friction modifiers
        let currentFriction = groundFriction;
        const weather = WeatherManager.getInstance().getWeatherState();
        if (weather.type === WeatherType.RAIN) currentFriction *= rainMult;
        else if (weather.type === WeatherType.SNOW) currentFriction *= snowMult;

        const entityIds = entityManager.query(['transform', 'physics']);

        for (const id of entityIds) {
            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const physics = entityManager.getComponent<PhysicsComponent>(id, 'physics')!;
            const input = entityManager.getComponent<InputComponent>(id, 'input');
            const tag = entityManager.getComponent<TagComponent>(id, 'tag');
            const health = entityManager.getComponent<HealthComponent>(id, 'health');

            // Store state for interpolation
            transform.prevX = transform.x;
            transform.prevY = transform.y;
            transform.prevZ = transform.z;

            if (physics.isStatic || (health && !health.active)) continue;

            // 1. Force Accumulator
            let forceX = 0;
            let forceY = 0;
            let forceZ = 0; // Vertical force

            // 2. Handle Input (Thrust)
            if (input) {
                if (tag?.tag === 'player' && (entityManager as any).inputManager) {
                    const im = (entityManager as any).inputManager;
                    const dx = im.mouseX - (window.innerWidth / 2);
                    const dy = im.mouseY - (window.innerHeight / 2);
                    transform.rotation = Math.atan2(dy, dx);
                } else if (tag?.tag !== 'player') {
                    transform.rotation += input.turn * turnSpeed * dt;
                }

                if (input.throttle !== 0) {
                    const thrust = input.throttle * maxThrust;
                    forceX += Math.cos(transform.rotation) * thrust;
                    forceY += Math.sin(transform.rotation) * thrust;
                }
            }

            // 3. Apply Steering Forces (from AI)
            if (physics.steeringForceX !== 0 || physics.steeringForceY !== 0) {
                forceX += physics.steeringForceX;
                forceY += physics.steeringForceY;

                physics.steeringForceX = 0;
                physics.steeringForceY = 0;
            }

            // 4. Calculate Friction Force: Ff = -v * mass * coeff * gravity_ref
            // We use the entity's frictionMultiplier to allow per-entity adjustments
            const ppm = config.getPixelsPerMeter();
            const appliedFrictionCoeff = currentFriction * physics.frictionMultiplier;
            // mu * g gives a decay rate in s^-1
            const frictionFX = -physics.vx * physics.mass * appliedFrictionCoeff * (gravity / 5.0);
            const frictionFY = -physics.vy * physics.mass * appliedFrictionCoeff * (gravity / 5.0);

            forceX += frictionFX;
            forceY += frictionFY;

            // 5. Physics Update (Euler integration)
            // If maxThrust is in Newtons, we scale acceleration by ppm
            const ax = (forceX / physics.mass);
            const ay = (forceY / physics.mass);

            // Apply Gravity to Z if in air
            if (transform.z < 0 || physics.vz !== 0) {
                // gravity is m/s^2, so we multiply by ppm to get pixels/s^2
                forceZ += physics.mass * gravity * ppm;
                const az = forceZ / physics.mass;
                physics.vz += az * dt;
            }

            physics.vx += ax * dt;
            physics.vy += ay * dt;

            // 6. Predict Position
            let nextX = transform.x + physics.vx * dt;
            let nextY = transform.y + physics.vy * dt;
            let nextZ = transform.z + physics.vz * dt;

            // Landing logic
            if (nextZ > 0) {
                nextZ = 0;
                physics.vz = 0;
            }

            // Log if enabled
            if (physicsLogs) {
                if (tag?.tag === 'player') {
                    console.log(`[Physics] Player: Mass=${physics.mass.toFixed(1)}, Thrust=(${forceX.toFixed(0)},${forceY.toFixed(0)}), Friction=(${frictionFX.toFixed(0)},${frictionFY.toFixed(0)}), Accel=(${ax.toFixed(1)},${ay.toFixed(1)}), Vel=(${physics.vx.toFixed(1)},${physics.vy.toFixed(1)})`);
                } else if (tag?.tag === 'enemy' && ConfigManager.getInstance().get<boolean>('Debug', 'extendedLogs')) {
                    // Log enemy physics only if extended logs are also on to avoid flooding, 
                    // or maybe just log one representative enemy?
                    // Let's log if it's an enemy and we want physics logs.
                    console.log(`[Physics] Enemy(${id.split('-')[0]}): Mass=${physics.mass.toFixed(1)}, TotalForce=(${forceX.toFixed(0)},${forceY.toFixed(0)}), Vel=(${physics.vx.toFixed(1)},${physics.vy.toFixed(1)})`);
                }
            }

            // 7. Align Rotation to Velocity (for Projectiles)
            if (physics.alignRotationToVelocity) {
                const speedSq = physics.vx * physics.vx + physics.vy * physics.vy;
                const minSpeed = 2.0 * ppm; // approx 2m/s
                if (speedSq > (minSpeed * minSpeed)) {
                    transform.rotation = Math.atan2(physics.vy, physics.vx);
                }
            }

            // 8. World Collision
            if (tag?.tag !== 'projectile') {
                const wallResult = PhysicsSystem.checkCircleVsTile(this.world, nextX, nextY, physics.radius);
                nextX = wallResult.x;
                nextY = wallResult.y;

                if (wallResult.hit) {
                    if (wallResult.nx !== 0 || wallResult.ny !== 0) {
                        const dot = physics.vx * wallResult.nx + physics.vy * wallResult.ny;
                        if (dot < 0) {
                            physics.vx -= dot * wallResult.nx;
                            physics.vy -= dot * wallResult.ny;
                        }
                    }
                }

                // Map Bounds
                const mapW = this.world.getWidthPixels();
                const mapH = this.world.getHeightPixels();
                if (nextX < physics.radius) { nextX = physics.radius; physics.vx = 0; }
                if (nextX > mapW - physics.radius) { nextX = mapW - physics.radius; physics.vx = 0; }
                if (nextY < physics.radius) { nextY = physics.radius; physics.vy = 0; }
                if (nextY > mapH - physics.radius) { nextY = mapH - physics.radius; physics.vy = 0; }
            }

            // 9. Entity vs Entity (Separation)
            const separation = this.calculateSeparation(id, nextX, nextY, physics, entityManager);
            nextX += separation.x;
            nextY += separation.y;
            if (separation.x !== 0 || separation.y !== 0) {
                // Separation force scaled by ppm
                physics.vx += separation.x * 5 * ppm;
                physics.vy += separation.y * 5 * ppm;
            }

            // 10. Commit Final Position
            transform.x = nextX;
            transform.y = nextY;
            transform.z = nextZ;
        }
    }

    // Public static method for universal access (Physics "Single Source of Truth")
    public static checkCircleVsTile(world: World, px: number, py: number, radius: number): { x: number, y: number, hit: boolean, nx: number, ny: number } {
        const tileSize = world.getTileSize();
        const checkRadius = radius;
        const subDiv = 10;
        const subSize = tileSize / subDiv;

        const minTX = Math.floor((px - checkRadius) / tileSize);
        const maxTX = Math.floor((px + checkRadius) / tileSize);
        const minTY = Math.floor((py - checkRadius) / tileSize);
        const maxTY = Math.floor((py + checkRadius) / tileSize);

        const heatMap = world.getHeatMap();

        let finalX = px;
        let finalY = py;
        let hitAny = false;
        let avgNX = 0;
        let avgNY = 0;
        let hitCount = 0;

        for (let ty = minTY; ty <= maxTY; ty++) {
            for (let tx = minTX; tx <= maxTX; tx++) {
                const material = world.getTile(tx, ty);
                if (material === 0) continue;

                const hasHeatMapData = heatMap && heatMap.hasTileData(tx, ty);

                if (!hasHeatMapData) {
                    // FAST PATH: Tile is fully intact
                    const result = PhysicsSystem.resolveAABBCollision(finalX, finalY, tx * tileSize, ty * tileSize, tileSize, checkRadius);
                    if (result.hit) {
                        finalX = result.x;
                        finalY = result.y;
                        hitAny = true;
                        avgNX += result.nx;
                        avgNY += result.ny;
                        hitCount++;
                    }
                } else {
                    // ACCURATE PATH: Tile is damaged
                    const hpData = heatMap.getTileHP(tx, ty);
                    if (!hpData) continue;

                    const tileWX = tx * tileSize;
                    const tileWY = ty * tileSize;

                    const localMinSX = Math.max(0, Math.floor((finalX - checkRadius - tileWX) / subSize));
                    const localMaxSX = Math.min(subDiv - 1, Math.floor((finalX + checkRadius - tileWX) / subSize));
                    const localMinSY = Math.max(0, Math.floor((finalY - checkRadius - tileWY) / subSize));
                    const localMaxSY = Math.min(subDiv - 1, Math.floor((finalY + checkRadius - tileWY) / subSize));

                    for (let sy = localMinSY; sy <= localMaxSY; sy++) {
                        for (let sx = localMinSX; sx <= localMaxSX; sx++) {
                            if (hpData[sy * subDiv + sx] > 0) {
                                const result = PhysicsSystem.resolveAABBCollision(
                                    finalX, finalY,
                                    tileWX + sx * subSize,
                                    tileWY + sy * subSize,
                                    subSize,
                                    checkRadius
                                );
                                if (result.hit) {
                                    finalX = result.x;
                                    finalY = result.y;
                                    hitAny = true;
                                    avgNX += result.nx;
                                    avgNY += result.ny;
                                    hitCount++;
                                }
                            }
                        }
                    }
                }
            }
        }

        if (hitCount > 0) {
            const len = Math.sqrt(avgNX * avgNX + avgNY * avgNY) || 1;
            avgNX /= len;
            avgNY /= len;
        }

        return { x: finalX, y: finalY, hit: hitAny, nx: avgNX, ny: avgNY };
    }

    private static resolveAABBCollision(px: number, py: number, rx: number, ry: number, rSize: number, radius: number): { x: number, y: number, hit: boolean, nx: number, ny: number } {
        const closestX = Math.max(rx, Math.min(px, rx + rSize));
        const closestY = Math.max(ry, Math.min(py, ry + rSize));

        const dx = px - closestX;
        const dy = py - closestY;
        const distSq = dx * dx + dy * dy;

        if (distSq < radius * radius) {
            const dist = Math.sqrt(distSq) || 0.0001;
            const overlap = radius - dist;
            const nx = dx / dist;
            const ny = dy / dist;

            return { x: px + nx * overlap, y: py + ny * overlap, hit: true, nx, ny };
        }
        return { x: px, y: py, hit: false, nx: 0, ny: 0 };
    }

    private calculateSeparation(id: string, nextX: number, nextY: number, physics: PhysicsComponent, entityManager: EntityManager): { x: number, y: number } {
        const range = physics.radius * 2.5;
        const neighbors = this.spatialGrid.retrieve({ x: nextX - range, y: nextY - range, w: range * 2, h: range * 2 });

        let sepX = 0;
        let sepY = 0;
        let count = 0;

        for (const other of neighbors) {
            const otherTag = entityManager.getComponent<TagComponent>(other.id, 'tag')?.tag;
            const myTag = entityManager.getComponent<TagComponent>(id, 'tag')?.tag;

            if (other.id === id) continue;
            if (otherTag === 'projectile' || myTag === 'projectile') continue;
            if (otherTag === 'drop' || myTag === 'drop') continue;

            const otherHealth = entityManager.getComponent<HealthComponent>(other.id, 'health');
            if (otherHealth && !otherHealth.active) continue;

            // Check if ECS entity (prefer Transform/Physics components if available)
            // But Quadtree stores Entity instances (which map to ECS IDs if we set them up right).
            // However, Quadtree in Simulation stores 'Entity' objects (the class). 
            // We need to bridge this.
            // Assumption: The 'Entity' class objects IN the Quadtree have an 'id' that matches the ECS id (if they are ECS entities).
            // OR they are legacy entities. 
            // We'll treat them as circles.

            const dx = nextX - other.x;
            const dy = nextY - other.y;
            const distSq = dx * dx + dy * dy;
            const radSum = physics.radius + other.radius;

            if (distSq > 0 && distSq < radSum * radSum) {
                const dist = Math.sqrt(distSq);
                const overlap = radSum - dist;
                const push = Math.min(overlap, 2.0); // Limit push per frame to avoid instability

                sepX += (dx / dist) * push;
                sepY += (dy / dist) * push;
                count++;
            }
        }

        if (count > 0) {
            // Average out and dampen
            // Heuristic: move partially to resolve
            return { x: sepX * 0.5, y: sepY * 0.5 };
        }
        return { x: 0, y: 0 };
    }
}