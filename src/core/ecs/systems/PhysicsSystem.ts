import { System } from "../System";
import { EntityManager } from "../EntityManager";
import { TransformComponent } from "../components/TransformComponent";
import { PhysicsComponent } from "../components/PhysicsComponent";
import { InputComponent } from "../components/InputComponent";
import { TagComponent } from "../components/TagComponent";
import { ConfigManager } from "../../../config/MasterConfig";
import { World } from "../../World";
import { WeatherManager, WeatherType } from "../../WeatherManager";

export class PhysicsSystem implements System {
    public readonly id = 'physics';
    
    private spatialGrid: Map<string, string[]> = new Map();
    private gridSize: number = 128;
    
    private accumulator: number = 0;
    private readonly fixedTimeStep: number = 1 / 60;
    public alpha: number = 0;

    constructor(private world: World) {}

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

        const entities = entityManager.query(['transform', 'physics']);
        
        // 1. Update Spatial Grid
        this.updateGrid(entities, entityManager);

        for (const id of entities) {
            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const physics = entityManager.getComponent<PhysicsComponent>(id, 'physics')!;
            const input = entityManager.getComponent<InputComponent>(id, 'input');
            const tag = entityManager.getComponent<TagComponent>(id, 'tag');

            if (physics.isStatic) continue;

            // Store state for interpolation
            transform.prevX = transform.x;
            transform.prevY = transform.y;

            // 2. Handle Input (Consolidated from MovementSystem)
            if (input) {
                if (tag?.tag !== 'player') {
                    transform.rotation += input.turn * turnSpeed * dt;
                }
                if (input.throttle !== 0) {
                    const speedPx = baseSpeed * tileSize;
                    physics.vx += Math.cos(transform.rotation) * input.throttle * speedPx * dt * 5;
                    physics.vy += Math.sin(transform.rotation) * input.throttle * speedPx * dt * 5;
                }
            }

            // 3. Apply Friction
            physics.vx *= Math.pow(friction, dt * 60);
            physics.vy *= Math.pow(friction, dt * 60);

            // 4. Predict Position
            let nextX = transform.x + physics.vx * dt;
            let nextY = transform.y + physics.vy * dt;

            // 5. World Collision (Hybrid Circle-vs-SubTile)
            const checkRadius = physics.radius;
            const subDiv = 10;
            const subSize = tileSize / subDiv;
            
            const minTX = Math.floor((nextX - checkRadius) / tileSize);
            const maxTX = Math.floor((nextX + checkRadius) / tileSize);
            const minTY = Math.floor((nextY - checkRadius) / tileSize);
            const maxTY = Math.floor((nextY + checkRadius) / tileSize);

            const heatMap = this.world.getHeatMap();

            for (let ty = minTY; ty <= maxTY; ty++) {
                for (let tx = minTX; tx <= maxTX; tx++) {
                    const material = this.world.getTile(tx, ty);
                    if (material === 0) continue; // MaterialType.NONE

                    const hasHeatMapData = heatMap && heatMap.hasTileData(tx, ty);

                    if (!hasHeatMapData) {
                        // FAST PATH: Tile is fully intact, use one AABB check
                        const result = this.resolveAABBCollision(nextX, nextY, tx * tileSize, ty * tileSize, tileSize, checkRadius, physics);
                        nextX = result.x;
                        nextY = result.y;
                    } else {
                        // ACCURATE PATH: Tile is damaged, check sub-tiles
                        const hpData = heatMap.getTileHP(tx, ty);
                        if (!hpData) continue;

                        const tileWX = tx * tileSize;
                        const tileWY = ty * tileSize;
                        
                        // Further optimization: Only check sub-tiles that overlap the entity's bounding box
                        const localMinSX = Math.max(0, Math.floor((nextX - checkRadius - tileWX) / subSize));
                        const localMaxSX = Math.min(subDiv - 1, Math.floor((nextX + checkRadius - tileWX) / subSize));
                        const localMinSY = Math.max(0, Math.floor((nextY - checkRadius - tileWY) / subSize));
                        const localMaxSY = Math.min(subDiv - 1, Math.floor((nextY + checkRadius - tileWY) / subSize));

                        for (let sy = localMinSY; sy <= localMaxSY; sy++) {
                            for (let sx = localMinSX; sx <= localMaxSX; sx++) {
                                if (hpData[sy * subDiv + sx] > 0) {
                                    const result = this.resolveAABBCollision(
                                        nextX, nextY, 
                                        tileWX + sx * subSize, 
                                        tileWY + sy * subSize, 
                                        subSize, 
                                        checkRadius,
                                        physics
                                    );
                                    nextX = result.x;
                                    nextY = result.y;
                                }
                            }
                        }
                    }
                }
            }

            // Map Bounds
            const mapW = this.world.getWidthPixels();
            const mapH = this.world.getHeightPixels();
            if (nextX < checkRadius) { nextX = checkRadius; physics.vx = 0; }
            if (nextX > mapW - checkRadius) { nextX = mapW - checkRadius; physics.vx = 0; }
            if (nextY < checkRadius) { nextY = checkRadius; physics.vy = 0; }
            if (nextY > mapH - checkRadius) { nextY = mapH - checkRadius; physics.vy = 0; }

            // 6. Body vs Body Collision
            this.resolveBodyCollisions(id, nextX, nextY, physics, entityManager);

            // 7. Commit Final Position
            transform.x = nextX;
            transform.y = nextY;
        }
    }

    private resolveAABBCollision(px: number, py: number, rx: number, ry: number, rSize: number, radius: number, physics: PhysicsComponent): {x: number, y: number} {
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

            px += nx * overlap;
            py += ny * overlap;

            // Slide velocity
            const dot = physics.vx * nx + physics.vy * ny;
            if (dot < 0) {
                physics.vx -= dot * nx;
                physics.vy -= dot * ny;
            }
        }
        return { x: px, y: py };
    }

    private updateGrid(entities: string[], entityManager: EntityManager): void {
        this.spatialGrid.clear();
        for (const id of entities) {
            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const gx = Math.floor(transform.x / this.gridSize);
            const gy = Math.floor(transform.y / this.gridSize);
            const key = `${gx},${gy}`;
            if (!this.spatialGrid.has(key)) this.spatialGrid.set(key, []);
            this.spatialGrid.get(key)!.push(id);
        }
    }

    private resolveBodyCollisions(id: string, nextX: number, nextY: number, physics: PhysicsComponent, entityManager: EntityManager): void {
        const gx = Math.floor(nextX / this.gridSize);
        const gy = Math.floor(nextY / this.gridSize);

        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const key = `${gx + ox},${gy + oy}`;
                const cell = this.spatialGrid.get(key);
                if (!cell) continue;

                for (const otherId of cell) {
                    if (id === otherId) continue;
                    
                    const otherTransform = entityManager.getComponent<TransformComponent>(otherId, 'transform')!;
                    const otherPhysics = entityManager.getComponent<PhysicsComponent>(otherId, 'physics')!;
                    if (otherPhysics.isStatic) continue;

                    const dx = nextX - otherTransform.x;
                    const dy = nextY - otherTransform.y;
                    const distSq = dx * dx + dy * dy;
                    const radSum = physics.radius + otherPhysics.radius;

                    if (distSq < radSum * radSum && distSq > 0) {
                        const dist = Math.sqrt(distSq);
                        const overlap = (radSum - dist);
                        const nx = dx / dist;
                        const ny = dy / dist;

                        // Mass-weighted resolution
                        // Heavier entities are pushed less
                        const totalMass = physics.mass + otherPhysics.mass;
                        const ratio1 = otherPhysics.mass / totalMass; // Current entity push ratio
                        const ratio2 = physics.mass / totalMass;       // Other entity push ratio

                        nextX += nx * overlap * ratio1;
                        nextY += ny * overlap * ratio1;

                        otherTransform.x -= nx * overlap * ratio2;
                        otherTransform.y -= ny * overlap * ratio2;

                        // Increased dampening on velocity when colliding to prevent "infinite push"
                        physics.vx *= 0.8;
                        physics.vy *= 0.8;
                        otherPhysics.vx *= 0.8;
                        otherPhysics.vy *= 0.8;
                    }
                }
            }
        }
    }
}
