import { System } from "../System";
import { EntityManager } from "../EntityManager";
import { AIComponent } from "../components/AIComponent";
import { TransformComponent } from "../components/TransformComponent";
import { PhysicsComponent } from "../components/PhysicsComponent";
import { TagComponent } from "../components/TagComponent";
import { HealthComponent } from "../components/HealthComponent";
import { World } from "../../World";
import { Pathfinder } from "../../../utils/Pathfinder";
import { AIBehavior } from "../components/AIDossier";

export class AISystem implements System {
    public readonly id = 'ai';
    private world: World;
    private pathUpdateInterval: number = 0.5; // Update path every 0.5 seconds

    constructor(world: World) {
        this.world = world;
    }

    update(dt: number, entityManager: EntityManager): void {
        const playerEntities = entityManager.query(['tag', 'transform']);
        const playerId = playerEntities.find(id => {
            const tag = entityManager.getComponent<TagComponent>(id, 'tag');
            return tag?.tag === 'player';
        });

        if (!playerId) return;

        const playerTransform = entityManager.getComponent<TransformComponent>(playerId, 'transform')!;
        const aiEntities = entityManager.query(['ai', 'transform', 'physics']);

        for (const id of aiEntities) {
            const health = entityManager.getComponent<HealthComponent>(id, 'health');
            if (health && !health.active) continue;

            const ai = entityManager.getComponent<AIComponent>(id, 'ai')!;
            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const physics = entityManager.getComponent<PhysicsComponent>(id, 'physics')!;

            // 1. Pathfinding Update
            ai.lastPathUpdateTime += dt;
            if (ai.lastPathUpdateTime >= this.pathUpdateInterval) {
                ai.lastPathUpdateTime = 0;
                
                // Only path if player is somewhat far or we are stuck
                const dx = playerTransform.x - transform.x;
                const dy = playerTransform.y - transform.y;
                const distToPlayer = Math.sqrt(dx * dx + dy * dy);

                if (distToPlayer > 50) {
                    const canBreach = ai.dossier?.traits.includes('breacher') || ai.behavior === AIBehavior.BREACHER;
                    ai.path = Pathfinder.findPath(
                        this.world, 
                        transform.x, 
                        transform.y, 
                        playerTransform.x, 
                        playerTransform.y,
                        canBreach
                    );
                    ai.nextWaypointIndex = 0;
                } else {
                    ai.path = [];
                }
            }

            // 2. Behavior Execution
            this.executeBehavior(dt, ai, transform, physics, playerTransform);
        }
    }

    private executeBehavior(
        dt: number, 
        ai: AIComponent, 
        transform: TransformComponent, 
        physics: PhysicsComponent, 
        playerTransform: TransformComponent
    ): void {
        const dx = playerTransform.x - transform.x;
        const dy = playerTransform.y - transform.y;
        const distToPlayer = Math.sqrt(dx * dx + dy * dy);

        // If we have a path and are not right next to the player, follow it
        if (ai.path.length > 0 && ai.nextWaypointIndex < ai.path.length && distToPlayer > 40) {
            const waypoint = ai.path[ai.nextWaypointIndex];
            const wdx = waypoint.x - transform.x;
            const wdy = waypoint.y - transform.y;
            const wdist = Math.sqrt(wdx * wdx + wdy * wdy);

            if (wdist < 10) {
                ai.nextWaypointIndex++;
                // Stop if reached end
                if (ai.nextWaypointIndex >= ai.path.length) {
                    physics.vx = 0;
                    physics.vy = 0;
                    return;
                }
            } else {
                physics.vx = (wdx / wdist) * ai.speed;
                physics.vy = (wdy / wdist) * ai.speed;
                transform.rotation = Math.atan2(wdy, wdx);
                return;
            }
        }

        // Behavior-specific logic when close or no path
        switch (ai.behavior) {
            case AIBehavior.CHASE:
            case AIBehavior.KAMIKAZE:
            case AIBehavior.BREACHER:
                if (distToPlayer > 5) {
                    physics.vx = (dx / distToPlayer) * ai.speed;
                    physics.vy = (dy / distToPlayer) * ai.speed;
                    transform.rotation = Math.atan2(dy, dx);
                } else {
                    physics.vx = 0;
                    physics.vy = 0;
                }
                break;

            case AIBehavior.SNIPER:
                const preferredDist = ai.dossier?.baseStats.preferredDistance || 200;
                if (distToPlayer < preferredDist - 20) {
                    // Move away
                    physics.vx = -(dx / distToPlayer) * ai.speed;
                    physics.vy = -(dy / distToPlayer) * ai.speed;
                } else if (distToPlayer > preferredDist + 20) {
                    // Move closer
                    physics.vx = (dx / distToPlayer) * ai.speed;
                    physics.vy = (dy / distToPlayer) * ai.speed;
                } else {
                    physics.vx = 0;
                    physics.vy = 0;
                }
                transform.rotation = Math.atan2(dy, dx);
                break;

            case AIBehavior.STATIONARY:
                physics.vx = 0;
                physics.vy = 0;
                transform.rotation = Math.atan2(dy, dx);
                break;

            default:
                // Fallback to simple chase
                if (distToPlayer > 0) {
                    physics.vx = (dx / distToPlayer) * ai.speed;
                    physics.vy = (dy / distToPlayer) * ai.speed;
                    transform.rotation = Math.atan2(dy, dx);
                }
                break;
        }
    }
}