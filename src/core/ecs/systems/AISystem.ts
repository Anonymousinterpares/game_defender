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
                // Friction for recovery phase
                physics.vx *= Math.pow(0.9, dt * 60);
                physics.vy *= Math.pow(0.9, dt * 60);
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

            // 3. Accumulate Steering Forces
            let forceX = 0;
            let forceY = 0;

            if (ai.path.length > 0 && ai.nextWaypointIndex < ai.path.length) {
                // Path following force
                const waypoint = ai.path[ai.nextWaypointIndex];
                const wdx = waypoint.x - transform.x;
                const wdy = waypoint.y - transform.y;
                const wdist = Math.sqrt(wdx * wdx + wdy * wdy);

                if (wdist < 15) {
                    ai.nextWaypointIndex++;
                } else {
                    forceX += (wdx / wdist) * ai.speed;
                    forceY += (wdy / wdist) * ai.speed;
                }
            } else if (distToPlayer > 10) {
                // Direct pursuit if close or no path
                forceX += (dx / distToPlayer) * ai.speed;
                forceY += (dy / distToPlayer) * ai.speed;
            }

            // Apply Behavior modifiers (like Sniper staying away)
            if (ai.behavior === AIBehavior.SNIPER) {
                const preferredDist = ai.dossier?.baseStats.preferredDistance || 250;
                if (distToPlayer < preferredDist) {
                    // Reverse the force if too close
                    forceX *= -1.2; 
                    forceY *= -1.2;
                }
            }

            // Apply steering and update rotation
            const steeringWeight = 5.0; // How fast they turn/adjust
            physics.vx += (forceX - physics.vx) * dt * steeringWeight;
            physics.vy += (forceY - physics.vy) * dt * steeringWeight;

            if (Math.abs(physics.vx) > 0.1 || Math.abs(physics.vy) > 0.1) {
                transform.rotation = Math.atan2(physics.vy, physics.vx);
            }

            // 4. Crowd Simulation (Separation is KEY)
            this.applySteering(id, aiEntities, entityManager, transform, physics, ai, dt);
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
        ai: AIComponent,
        dt: number
    ): void {
        let sepX = 0, sepY = 0; // Separation
        let aliX = 0, aliY = 0; // Alignment
        let cohX = 0, cohY = 0; // Cohesion
        
        let sepCount = 0;
        let flockCount = 0;

        const sepDist = 40; // Increased separation distance
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
                sepX += (dx / dist) * (sepDist - dist); // Inverse weight
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

        const steeringForce = 150;

        // Apply Separation
        if (sepCount > 0) {
            physics.vx += (sepX / sepCount) * steeringForce * dt;
            physics.vy += (sepY / sepCount) * steeringForce * dt;
        }

        // Apply Alignment & Cohesion (Flocking)
        if (flockCount > 0) {
            // Alignment: Match velocity
            const avgAliX = aliX / flockCount;
            const avgAliY = aliY / flockCount;
            physics.vx += (avgAliX - physics.vx) * 0.1 * dt * 60;
            physics.vy += (avgAliY - physics.vy) * 0.1 * dt * 60;

            // Cohesion: Move to center
            const avgCohX = cohX / flockCount;
            const avgCohY = cohY / flockCount;
            const cohDirX = avgCohX - transform.x;
            const cohDirY = avgCohY - transform.y;
            const cohDist = Math.sqrt(cohDirX * cohDirX + cohDirY * cohDirY);
            if (cohDist > 0) {
                physics.vx += (cohDirX / cohDist) * (steeringForce * 0.2) * dt;
                physics.vy += (cohDirY / cohDist) * (steeringForce * 0.2) * dt;
            }
        }
    }
}