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

            // 1. Vision / Line of Sight Check
            const canSeePlayer = this.checkLOS(transform, playerTransform);
            const isTracker = ai.dossier?.traits.includes('tracker');
            
            // AI only updates path if it can see player OR is a tracker OR is already close enough to "hear"
            const dx = playerTransform.x - transform.x;
            const dy = playerTransform.y - transform.y;
            const distToPlayer = Math.sqrt(dx * dx + dy * dy);
            const canHearPlayer = distToPlayer < 150;

            const shouldUpdatePath = canSeePlayer || isTracker || canHearPlayer;

            // 2. Pathfinding Update
            ai.lastPathUpdateTime += dt;
            if (ai.lastPathUpdateTime >= this.pathUpdateInterval && shouldUpdatePath) {
                ai.lastPathUpdateTime = 0;
                
                if (distToPlayer > 50) {
                    const canBreach = ai.dossier?.traits.includes('breacher') || ai.behavior === AIBehavior.BREACHER;
                    const isHeatProof = ai.dossier?.traits.includes('heat_proof');
                    
                    ai.path = Pathfinder.findPath(
                        this.world, 
                        transform.x, 
                        transform.y, 
                        playerTransform.x, 
                        playerTransform.y,
                        canBreach,
                        isHeatProof
                    );
                    ai.nextWaypointIndex = 0;
                } else {
                    ai.path = [];
                }
            }

            // 3. Behavior Execution
            if (shouldUpdatePath || ai.path.length > 0) {
                this.executeBehavior(dt, ai, transform, physics, playerTransform);
            } else {
                physics.vx *= 0.9; // Slow down if lost player
                physics.vy *= 0.9;
            }

            // 4. Crowd Simulation (Steering Behaviors)
            this.applySteering(id, aiEntities, entityManager, transform, physics, ai);
        }
    }

    private checkLOS(from: TransformComponent, to: TransformComponent): boolean {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        
        // Raycast returns hit point or null if clear
        const hit = this.world.raycast(from.x, from.y, angle, dist);
        return hit === null;
    }

    private applySteering(
        id: string, 
        allAiIds: string[], 
        entityManager: EntityManager, 
        transform: TransformComponent, 
        physics: PhysicsComponent,
        ai: AIComponent
    ): void {
        let sepX = 0, sepY = 0; // Separation
        let aliX = 0, aliY = 0; // Alignment
        let cohX = 0, cohY = 0; // Cohesion
        
        let sepCount = 0;
        let flockCount = 0;

        const sepDist = 35;
        const flockDist = 100;

        for (const otherId of allAiIds) {
            if (id === otherId) continue;
            
            const otherTransform = entityManager.getComponent<TransformComponent>(otherId, 'transform');
            const otherPhysics = entityManager.getComponent<PhysicsComponent>(otherId, 'physics');
            const otherAi = entityManager.getComponent<AIComponent>(otherId, 'ai');
            if (!otherTransform || !otherPhysics || !otherAi) continue;

            const dx = transform.x - otherTransform.x;
            const dy = transform.y - otherTransform.y;
            const distSq = dx * dx + dy * dy;

            // Separation (Avoid all)
            if (distSq > 0 && distSq < sepDist * sepDist) {
                const dist = Math.sqrt(distSq);
                sepX += dx / dist;
                sepY += dy / dist;
                sepCount++;
            }

            // Alignment & Cohesion (Only with same behavior/dossier type)
            if (otherAi.behavior === ai.behavior && distSq < flockDist * flockDist) {
                aliX += otherPhysics.vx;
                aliY += otherPhysics.vy;
                
                cohX += otherTransform.x;
                cohY += otherTransform.y;
                flockCount++;
            }
        }

        const steeringForce = 40;

        // Apply Separation
        if (sepCount > 0) {
            physics.vx += (sepX / sepCount) * (steeringForce * 1.5);
            physics.vy += (sepY / sepCount) * (steeringForce * 1.5);
        }

        // Apply Alignment & Cohesion (Flocking)
        if (flockCount > 0) {
            // Alignment: Match velocity
            const avgAliX = aliX / flockCount;
            const avgAliY = aliY / flockCount;
            physics.vx += (avgAliX - physics.vx) * 0.05;
            physics.vy += (avgAliY - physics.vy) * 0.05;

            // Cohesion: Move to center
            const avgCohX = cohX / flockCount;
            const avgCohY = cohY / flockCount;
            const cohDirX = avgCohX - transform.x;
            const cohDirY = avgCohY - transform.y;
            const cohDist = Math.sqrt(cohDirX * cohDirX + cohDirY * cohDirY);
            if (cohDist > 0) {
                physics.vx += (cohDirX / cohDist) * (steeringForce * 0.5);
                physics.vy += (cohDirY / cohDist) * (steeringForce * 0.5);
            }
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

            case AIBehavior.FLOCK:
                // Move towards player but with less urgency, letting steering handle the group
                if (distToPlayer > 100) {
                    physics.vx = (dx / distToPlayer) * ai.speed * 0.8;
                    physics.vy = (dy / distToPlayer) * ai.speed * 0.8;
                } else if (distToPlayer > 10) {
                    physics.vx = (dx / distToPlayer) * ai.speed;
                    physics.vy = (dy / distToPlayer) * ai.speed;
                }
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