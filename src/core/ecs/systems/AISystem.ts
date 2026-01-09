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
import { EQS } from "../../ai/EQS";
import { EQSTestType } from "../../ai/EQSTypes";
import { GOAPPlanner } from "../../ai/GOAPPlanner";
import { GOAPAction, GOAPGoal, WorldState } from "../../ai/GOAPTypes";
import { EventBus, GameEvent } from "../../EventBus";
import { SoundRaycaster } from "../../../utils/SoundRaycaster";

export class AISystem implements System {
    public readonly id = 'ai';
    private world: World;
    private pathUpdateInterval: number = 0.5; 
    private eqsUpdateInterval: number = 1.0; 
    private goapUpdateInterval: number = 0.5;

    constructor(world: World) {
        this.world = world;
        this.setupAcousticListener();
    }

    private setupAcousticListener(): void {
        EventBus.getInstance().on(GameEvent.AI_ACOUSTIC_EVENT, (data) => {
            // This is a global listener, but we'll apply it during the update loop for each AI
            // or we could store it in a global "Recent Noises" buffer.
            // For now, let's keep it simple: any AI nearby will hear it.
            this.pendingAcousticEvents.push(data);
        });
    }

    private pendingAcousticEvents: any[] = [];

    private latestAcousticResults: Record<string, any> = {};

    public update(dt: number, entityManager: EntityManager): void {
        const playerEntity = entityManager.query(['player'])[0];
        if (!playerEntity) return;

        const playerTransform = entityManager.getComponent<TransformComponent>(playerEntity, 'transform')!;
        const aiEntities = entityManager.query(['ai', 'transform', 'physics']);

        // 1. Dispatch acoustic events to worker (Fire and forget)
        const events = [...this.pendingAcousticEvents];
        this.pendingAcousticEvents = [];

        if (events.length > 0) {
            const listeners = aiEntities.map(id => {
                const t = entityManager.getComponent<TransformComponent>(id, 'transform')!;
                return { id, x: t.x, y: t.y };
            });

            // We don't await. Results will come back in a future frame.
            events.forEach(event => {
                SoundRaycaster.propagate(
                    { x: event.x, y: event.y, volume: event.volume },
                    listeners,
                    this.world
                ).then(results => {
                    // Store results to be picked up in next frame
                    Object.assign(this.latestAcousticResults, results);
                });
            });
        }

        // 2. Process latest results from previous frame(s)
        for (const id of aiEntities) {
            const ai = entityManager.getComponent<AIComponent>(id, 'ai')!;
            const result = this.latestAcousticResults[id];
            
            if (result && result.volume > 5) {
                const saliency = result.volume / 100;
                
                if (!ai.isAlert || saliency > ai.perceptionCertainty) {
                    // Update Last Known Position from Acoustic Apparent Source
                    ai.lastKnownPosition = { x: result.apparentSource.x, y: result.apparentSource.y };
                    ai.isAlert = true;
                    // Boost certainty to at least 0.6 if we heard something significant
                    ai.perceptionCertainty = Math.max(ai.perceptionCertainty, Math.min(0.8, saliency + 0.3));
                    ai.patrolTarget = null;
                    ai.patrolTimer = 0;
                }
                // We keep the result for one frame, then clear
                delete this.latestAcousticResults[id];
            }
        }

        // 3. Main Loop
        for (const id of aiEntities) {
            const health = entityManager.getComponent<HealthComponent>(id, 'health');
            if (health && !health.active) continue;

            const ai = entityManager.getComponent<AIComponent>(id, 'ai')!;
            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const physics = entityManager.getComponent<PhysicsComponent>(id, 'physics')!;

            if (ai.waitTimer > 0) {
                ai.waitTimer -= dt;
                physics.vx *= Math.pow(0.9, dt * 60);
                physics.vy *= Math.pow(0.9, dt * 60);
                continue; 
            }

            // --- PERCEPTION PHASE ---
            this.updatePerception(dt, ai, transform, playerTransform);

            // --- TACTICAL PHASE ---
            // If we have no target but have LKP, we investigate
            const targetPos = ai.perceivedTargetPos || ai.lastKnownPosition;
            if (targetPos) {
                this.updateEQS(dt, ai, transform, targetPos);
            }

            // --- STRATEGIC PHASE ---
            if (ai.isAlert) {
                if (!ai.perceivedTargetPos) {
                    ai.state = 'investigate';
                } else {
                    ai.state = 'alert';
                }
                this.updateGOAP(dt, id, ai, transform);
                this.executeCurrentAction(dt, id, ai, transform, physics);
            } else {
                ai.state = 'idle';
                this.updatePatrol(dt, ai, transform, physics);
            }

            this.applySteering(id, aiEntities, entityManager, transform, physics, ai, dt);
        }

        this.pendingAcousticEvents = [];
    }

    private updatePerception(dt: number, ai: AIComponent, transform: TransformComponent, playerTransform: TransformComponent): void {
        const dossier = ai.dossier;
        if (!dossier) return;

        // 1. Vision Check (Multi-point)
        let canSee = false;
        const dx = playerTransform.x - transform.x;
        const dy = playerTransform.y - transform.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < dossier.baseStats.visualRange) {
            const angleToPlayer = Math.atan2(dy, dx);
            let diff = Math.abs(angleToPlayer - transform.rotation);
            if (diff > Math.PI) diff = Math.PI * 2 - diff;

            const fovRad = (dossier.baseStats.visualFOV * Math.PI) / 180;
            if (diff <= fovRad / 2 || dossier.traits.includes('tracker')) {
                // Multi-point LOS check: Center, and edges perpendicular to vision
                const pRadius = 15; // Player radius
                const perpAngle = angleToPlayer + Math.PI / 2;
                const points = [
                    { x: playerTransform.x, y: playerTransform.y },
                    { x: playerTransform.x + Math.cos(perpAngle) * pRadius, y: playerTransform.y + Math.sin(perpAngle) * pRadius },
                    { x: playerTransform.x - Math.cos(perpAngle) * pRadius, y: playerTransform.y - Math.sin(perpAngle) * pRadius }
                ];

                for (const p of points) {
                    if (this.checkLOS(transform, p)) {
                        canSee = true;
                        break;
                    }
                }
            }
        }

        if (canSee) {
            ai.perceivedTargetPos = { x: playerTransform.x, y: playerTransform.y };
            ai.lastKnownPosition = { x: playerTransform.x, y: playerTransform.y };
            ai.perceptionCertainty = 1.0;
            ai.isAlert = true;
        } else {
            ai.perceptionCertainty -= dt * 0.15; // Slightly slower decay (6-7 seconds)
            if (ai.perceptionCertainty <= 0) {
                ai.perceptionCertainty = 0;
                ai.perceivedTargetPos = null;
                ai.isAlert = false; // GO BACK TO IDLE
            }
        }
    }

    private updatePatrol(dt: number, ai: AIComponent, transform: TransformComponent, physics: PhysicsComponent): void {
        ai.state = 'patrol';
        ai.currentPlan = null;

        if (ai.patrolTimer > 0) {
            ai.patrolTimer -= dt;
            physics.vx *= Math.pow(0.8, dt * 60);
            physics.vy *= Math.pow(0.8, dt * 60);
            return;
        }

        if (!ai.patrolTarget) {
            // Find a random point nearby
            const angle = Math.random() * Math.PI * 2;
            const dist = 100 + Math.random() * 150;
            const tx = transform.x + Math.cos(angle) * dist;
            const ty = transform.y + Math.sin(angle) * dist;

            if (!this.world.isWall(tx, ty)) {
                ai.patrolTarget = { x: tx, y: ty };
            } else {
                ai.patrolTimer = 0.5; // Quick retry
            }
        } else {
            const dist = this.moveTowards(dt, ai, transform, physics, ai.patrolTarget);
            if (dist < 30) {
                ai.patrolTarget = null;
                ai.patrolTimer = 0.5 + Math.random() * 1.5; // Short pause
            }
        }
    }

    private updateEQS(dt: number, ai: AIComponent, transform: TransformComponent, target: {x: number, y: number}): void {
        ai.lastEQSUpdateTime += dt;
        if (ai.lastEQSUpdateTime >= this.eqsUpdateInterval) {
            ai.lastEQSUpdateTime = 0;
            
            const points = EQS.runQuery(this.world, {
                center: { x: transform.x, y: transform.y },
                radius: 300,
                density: 20,
                tests: [
                    { type: EQSTestType.DISTANCE, weight: 1.0, params: { preferred: 150 } },
                    { type: EQSTestType.LINE_OF_SIGHT, weight: 2.0 },
                    { type: EQSTestType.PROXIMITY_TO_WALL, weight: 0.8 }
                ]
            }, target);

            if (points.length > 0) {
                ai.eqsPoints = points;
                ai.bestTacticalPoint = points[0];
            }
        }
    }

    private updateGOAP(dt: number, entityId: string, ai: AIComponent, transform: TransformComponent): void {
        if (!ai.currentGoal) {
            ai.currentGoal = {
                name: 'NeutralizeThreat',
                priority: 100,
                desiredState: new Map([['threatEliminated', true]])
            };
        }

        if (!ai.currentPlan || ai.currentActionIndex >= ai.currentPlan.actions.length) {
            const worldState: WorldState = new Map([
                ['hasToken', ai.activeToken !== null],
                ['knowsTargetLocation', ai.perceivedTargetPos !== null],
                ['hasLKP', ai.lastKnownPosition !== null],
                ['atTargetPos', ai.bestTacticalPoint ? (Math.sqrt(Math.pow(transform.x - ai.bestTacticalPoint.x, 2) + Math.pow(transform.y - ai.bestTacticalPoint.y, 2)) < 30) : false],
                ['threatEliminated', false]
            ]);

            const actions: GOAPAction[] = [
                {
                    name: 'InvestigateLKP',
                    cost: 1,
                    preconditions: new Map([['knowsTargetLocation', false], ['hasLKP', true]]),
                    effects: new Map([['knowsTargetLocation', true]]),
                    isValid: () => ai.lastKnownPosition !== null
                },
                {
                    name: 'HoldPosition',
                    cost: 1,
                    preconditions: new Map([['knowsTargetLocation', true]]),
                    effects: new Map([['threatEliminated', true]]), 
                    isValid: () => ai.activeToken === null 
                },
                {
                    name: 'MoveToTacticalPosition',
                    cost: 2,
                    preconditions: new Map([['atTargetPos', false]]),
                    effects: new Map([['atTargetPos', true]]),
                    isValid: () => ai.bestTacticalPoint !== null || ai.lastKnownPosition !== null
                },
                {
                    name: 'RequestAttackToken',
                    cost: 1,
                    preconditions: new Map([['hasToken', false]]),
                    effects: new Map([['hasToken', true]]),
                    isValid: () => ai.activeToken === null && ai.isAlert
                },
                {
                    name: 'AttackTarget',
                    cost: 1,
                    preconditions: new Map([['atTargetPos', true], ['hasToken', true]]),
                    effects: new Map([['threatEliminated', true]]),
                    isValid: () => ai.perceivedTargetPos !== null
                }
            ];

            const plan = GOAPPlanner.plan(worldState, actions, ai.currentGoal);
            if (plan) {
                ai.currentPlan = plan;
                ai.currentActionIndex = 0;
                ai.state = plan.actions[0].name;
            }
        }
    }

    private executeCurrentAction(dt: number, entityId: string, ai: AIComponent, transform: TransformComponent, physics: PhysicsComponent): void {
        if (!ai.currentPlan || ai.currentActionIndex >= ai.currentPlan.actions.length) {
            physics.vx *= 0.9;
            physics.vy *= 0.9;
            return;
        }

        const action = ai.currentPlan.actions[ai.currentActionIndex];
        let actionCompleted = false;

        // Auto-release token if target lost or too far
        if (ai.activeToken === 'attack' && ai.perceivedTargetPos) {
            const dx = ai.perceivedTargetPos.x - transform.x;
            const dy = ai.perceivedTargetPos.y - transform.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist > 450) {
                EventBus.getInstance().emit(GameEvent.AI_RELEASE_TOKEN, { entityId, tokenType: 'attack' });
                ai.activeToken = null;
            }
        }

        switch (action.name) {
            case 'HoldPosition':
                physics.vx *= 0.8;
                physics.vy *= 0.8;
                // Transition out of Hold if we get a token or lose target
                if (ai.activeToken !== null || ai.perceivedTargetPos === null) actionCompleted = true;
                break;

            case 'InvestigateLKP':
                if (ai.lastKnownPosition) {
                    const dist = this.moveTowards(dt, ai, transform, physics, ai.lastKnownPosition);
                    // If we reach LKP or we see the target while moving, action is done
                    if (dist < 50 || ai.perceivedTargetPos !== null) actionCompleted = true;
                } else {
                    actionCompleted = true;
                }
                break;

            case 'MoveToTacticalPosition':
                const tacticalTarget = ai.bestTacticalPoint || ai.perceivedTargetPos || ai.lastKnownPosition;
                if (tacticalTarget) {
                    const dist = this.moveTowards(dt, ai, transform, physics, tacticalTarget);
                    if (dist < 40) actionCompleted = true;
                } else {
                    actionCompleted = true;
                }
                break;

            case 'RequestAttackToken':
                if (ai.activeToken === null) {
                    EventBus.getInstance().emit(GameEvent.AI_REQUEST_TOKEN, { entityId, tokenType: 'attack' });
                } else {
                    actionCompleted = true;
                }
                break;

            case 'AttackTarget':
                if (ai.perceivedTargetPos) {
                    const distToPlayer = this.moveTowards(dt, ai, transform, physics, ai.perceivedTargetPos);
                    if (distToPlayer < 40) actionCompleted = true; 
                } else {
                    actionCompleted = true;
                }
                break;
        }

        if (actionCompleted) {
            ai.currentActionIndex++;
            if (ai.currentActionIndex < ai.currentPlan.actions.length) {
                ai.state = ai.currentPlan.actions[ai.currentActionIndex].name;
            }
        }
    }

    private moveTowards(dt: number, ai: AIComponent, transform: TransformComponent, physics: PhysicsComponent, target: {x: number, y: number}): number {
        const dx = target.x - transform.x;
        const dy = target.y - transform.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        ai.lastPathUpdateTime += dt;
        if (ai.lastPathUpdateTime >= this.pathUpdateInterval) {
            ai.lastPathUpdateTime = 0;
            ai.path = Pathfinder.findPath(this.world, transform.x, transform.y, target.x, target.y);
            ai.nextWaypointIndex = 0;
        }

        let forceX = 0;
        let forceY = 0;

        if (ai.path.length > 0 && ai.nextWaypointIndex < ai.path.length) {
            const waypoint = ai.path[ai.nextWaypointIndex];
            const wdx = waypoint.x - transform.x;
            const wdy = waypoint.y - transform.y;
            const wdist = Math.sqrt(wdx * wdx + wdy * wdy);

            if (wdist < 15) {
                ai.nextWaypointIndex++;
            } else {
                forceX = (wdx / wdist) * ai.speed;
                forceY = (wdy / wdist) * ai.speed;
            }
        } else if (dist > 0) {
            forceX = (dx / dist) * ai.speed;
            forceY = (dy / dist) * ai.speed;
        }

        const steeringWeight = 8.0; 
        physics.vx += (forceX - physics.vx) * dt * steeringWeight;
        physics.vy += (forceY - physics.vy) * dt * steeringWeight;

        if (Math.abs(physics.vx) > 0.1 || Math.abs(physics.vy) > 0.1) {
            transform.rotation = Math.atan2(physics.vy, physics.vx);
        }

        return dist;
    }

    private checkLOS(from: TransformComponent, to: {x: number, y: number}): boolean {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
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
        let sepX = 0, sepY = 0; 
        let aliX = 0, aliY = 0; 
        let cohX = 0, cohY = 0; 
        
        let sepCount = 0;
        let flockCount = 0;

        const sepDist = 40; 
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

            if (distSq > 0 && distSq < sepDist * sepDist) {
                const dist = Math.sqrt(distSq);
                sepX += (dx / dist) * (sepDist - dist);
                sepCount++;
            }

            if (otherAi.behavior === ai.behavior && distSq < flockDist * flockDist) {
                aliX += otherPhysics.vx;
                aliY += otherPhysics.vy;
                
                cohX += otherTransform.x;
                cohY += otherTransform.y;
                flockCount++;
            }
        }

        const steeringForce = 150;

        if (sepCount > 0) {
            physics.vx += (sepX / sepCount) * steeringForce * dt;
            physics.vy += (sepY / sepCount) * steeringForce * dt;
        }

        if (flockCount > 0) {
            const avgAliX = aliX / flockCount;
            const avgAliY = aliY / flockCount;
            physics.vx += (avgAliX - physics.vx) * 0.1 * dt * 60;
            physics.vy += (avgAliY - physics.vy) * 0.1 * dt * 60;

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