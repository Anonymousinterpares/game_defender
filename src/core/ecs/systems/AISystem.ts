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

            // Recovery/Wait logic
            if (ai.waitTimer > 0) {
                ai.waitTimer -= dt;
                // Friction for recovery phase is handled in PhysicsSystem naturally now, 
                // but we can dampen via steering if needed.
                // For now, just let Physics friction take over, or apply a "stop" force.
                physics.steeringForceX = -physics.vx * 5 * physics.mass;
                physics.steeringForceY = -physics.vy * 5 * physics.mass;
                continue; 
            }

            // 1. Vision / Line of Sight Check
            const canSeePlayer = this.checkLOS(transform, playerTransform);
            const isTracker = ai.dossier?.traits.includes('tracker');
            
            const dx = playerTransform.x - transform.x;
            const dy = playerTransform.y - transform.y;
            const distToPlayer = Math.sqrt(dx * dx + dy * dy);
            const canHearPlayer = distToPlayer < 150;

            const shouldUpdatePath = (canSeePlayer || isTracker || canHearPlayer) && distToPlayer > 40;

            // 2. Pathfinding Update
            ai.lastPathUpdateTime += dt;
            if (ai.lastPathUpdateTime >= this.pathUpdateInterval && shouldUpdatePath) {
                ai.lastPathUpdateTime = 0;
                
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
            }

            // 3. Determine Desired Velocity (Target Direction)
            let desiredVx = 0;
            let desiredVy = 0;

            if (ai.path.length > 0 && ai.nextWaypointIndex < ai.path.length) {
                // Path following
                const waypoint = ai.path[ai.nextWaypointIndex];
                const wdx = waypoint.x - transform.x;
                const wdy = waypoint.y - transform.y;
                const wdist = Math.sqrt(wdx * wdx + wdy * wdy);

                if (wdist < 15) {
                    ai.nextWaypointIndex++;
                } else {
                    desiredVx += (wdx / wdist) * ai.speed;
                    desiredVy += (wdy / wdist) * ai.speed;
                }
            } else if (distToPlayer > 10) {
                // Direct pursuit if close or no path
                desiredVx += (dx / distToPlayer) * ai.speed;
                desiredVy += (dy / distToPlayer) * ai.speed;
            }

            // Apply Behavior modifiers (like Sniper staying away)
            if (ai.behavior === AIBehavior.SNIPER) {
                const preferredDist = ai.dossier?.baseStats.preferredDistance || 250;
                if (distToPlayer < preferredDist) {
                    // Reverse/Flee
                    desiredVx *= -1.2; 
                    desiredVy *= -1.2;
                }
            }

            // 4. Submit Steering Force to PhysicsSystem
            const steeringWeight = 5.0; // How fast they turn/adjust
            // Force = (DesiredVelocity - CurrentVelocity) * Mass * Rate
            physics.steeringForceX += (desiredVx - physics.vx) * steeringWeight * physics.mass;
            physics.steeringForceY += (desiredVy - physics.vy) * steeringWeight * physics.mass;

            // Update rotation based on current velocity
            if (Math.abs(physics.vx) > 0.1 || Math.abs(physics.vy) > 0.1) {
                transform.rotation = Math.atan2(physics.vy, physics.vx);
            }

            // Separation/Crowd logic is now handled in PhysicsSystem!
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
}
