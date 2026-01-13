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
        const baseSpeed = config.get<number>('Player', 'baseSpeed') || 5.0;
        const turnSpeed = config.get<number>('Player', 'turnSpeed') || 3.0;
        let friction = config.get<number>('Physics', 'friction') || 0.9;
        const tileSize = config.get<number>('World', 'tileSize') || 32;

        // Apply weather friction modifiers
        const weather = WeatherManager.getInstance().getWeatherState();
        if (weather.type === WeatherType.RAIN) friction *= 0.95;
        else if (weather.type === WeatherType.SNOW) friction *= 0.85;

        const entityIds = entityManager.query(['transform', 'physics']);

        // 1. Prepare entities for Quadtree updates (handled in Simulation usually, but let's ensure we use current positions)
        // Actually, Simulation.ts calls `updateSpatialGrid()` at the end of the frame. 
        // For Physics, we might want to query the LAST frame's grid or update it?
        // The instruction says "Spatial Grid Integration: Modify PhysicsSystem to use the Quadtree for entity-vs-entity collisions".
        // Assuming the Quadtree is up-to-date from the previous frame or Simulation loop.

        for (const id of entityIds) {
            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const physics = entityManager.getComponent<PhysicsComponent>(id, 'physics')!;
            const input = entityManager.getComponent<InputComponent>(id, 'input');
            const tag = entityManager.getComponent<TagComponent>(id, 'tag');
            const health = entityManager.getComponent<HealthComponent>(id, 'health');

            // Store state for interpolation (Must happen even for static entities)
            transform.prevX = transform.x;
            transform.prevY = transform.y;

            if (physics.isStatic || (health && !health.active)) continue;

            // 2. Handle Input (Consolidated from MovementSystem)
            if (input) {
                if (tag?.tag === 'player' && (entityManager as any).inputManager) {
                    const im = (entityManager as any).inputManager;
                    // Mouse Aiming for player
                    const dx = im.mouseX - (window.innerWidth / 2); // Assuming camera is centered on player
                    const dy = im.mouseY - (window.innerHeight / 2);
                    transform.rotation = Math.atan2(dy, dx);
                } else if (tag?.tag !== 'player') {
                    transform.rotation += input.turn * turnSpeed * dt;
                }

                if (input.throttle !== 0) {
                    const speedPx = baseSpeed * tileSize;
                    physics.vx += Math.cos(transform.rotation) * input.throttle * speedPx * dt * 5;
                    physics.vy += Math.sin(transform.rotation) * input.throttle * speedPx * dt * 5;
                }
            }

            // 3. Apply Steering Forces (from AI)
            if (physics.steeringForceX !== 0 || physics.steeringForceY !== 0) {
                const ax = physics.steeringForceX / physics.mass;
                const ay = physics.steeringForceY / physics.mass;
                physics.vx += ax * dt;
                physics.vy += ay * dt;

                physics.steeringForceX = 0;
                physics.steeringForceY = 0;
            }

            // 4. Apply Friction (multiplier 1.0 = full friction, 0.0 = no friction)
            const frictionToApply = 1.0 - (1.0 - Math.pow(friction, dt * 60)) * physics.frictionMultiplier;
            physics.vx *= frictionToApply;
            physics.vy *= frictionToApply;

            // 5. Predict Position
            let nextX = transform.x + physics.vx * dt;
            let nextY = transform.y + physics.vy * dt;

            // 6. Align Rotation to Velocity (for Projectiles)
            if (physics.alignRotationToVelocity) {
                const speedSq = physics.vx * physics.vx + physics.vy * physics.vy;
                if (speedSq > 100) { // Only rotate if moving significantly
                    transform.rotation = Math.atan2(physics.vy, physics.vx);
                }
            }

            // 6. World Collision (Centralized Logic)
            if (tag?.tag !== 'projectile') {
                const wallResult = PhysicsSystem.checkCircleVsTile(this.world, nextX, nextY, physics.radius);
                nextX = wallResult.x;
                nextY = wallResult.y;

                // Adjust velocity if hit wall
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

            // 7. Entity vs Entity (Separation via Quadtree)
            const separation = this.calculateSeparation(id, nextX, nextY, physics, entityManager);
            nextX += separation.x;
            nextY += separation.y;
            // Also apply separation to velocity to prevent re-entry
            if (separation.x !== 0 || separation.y !== 0) {
                physics.vx += separation.x * 5; // Impulse
                physics.vy += separation.y * 5;
            }

            // 8. Commit Final Position
            transform.x = nextX;
            transform.y = nextY;
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