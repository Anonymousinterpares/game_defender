import { System } from "../System";
import { EntityManager } from "../EntityManager";
import { TransformComponent } from "../components/TransformComponent";
import { PhysicsComponent } from "../components/PhysicsComponent";
import { ProjectileComponent, ProjectileType } from "../components/ProjectileComponent";
import { HealthComponent } from "../components/HealthComponent";
import { World } from "../../World";
import { HeatMap, MaterialType } from "../../HeatMap";
import { EventBus, GameEvent } from "../../EventBus";
import { Quadtree } from "../../../utils/Quadtree";
import { Entity } from "../../Entity";
import { CombatSystem } from "../../../systems/CombatSystem";
import { ConfigManager } from "../../../config/MasterConfig";
import { SegmentComponent } from "../components/SegmentComponent";

export class ProjectileSystem implements System {
    public readonly id = 'projectile_system';

    constructor(
        private world: World,
        private heatMap: HeatMap,
        private spatialGrid: Quadtree<Entity>,
        private combatSystem: CombatSystem
    ) { }

    update(dt: number, entityManager: EntityManager): void {
        const entities = entityManager.query(['transform', 'physics', 'projectile']);
        const extendedLogs = ConfigManager.getInstance().get<boolean>('Debug', 'extendedLogs');

        // HEARTBEAT LOG - Only if extended logs are enabled
        if (entities.length > 0 && extendedLogs) {
            console.log(`[ProjectileSystem] Update: Found ${entities.length} projectiles in ECS.`);
        }

        for (const id of entities) {
            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const physics = entityManager.getComponent<PhysicsComponent>(id, 'physics')!;
            const projectile = entityManager.getComponent<ProjectileComponent>(id, 'projectile')!;
            const health = entityManager.getComponent<HealthComponent>(id, 'health');

            // 1. Lifetime Management
            projectile.lifeTime -= dt;
            if (projectile.lifeTime <= 0) {
                this.deactivateEntity(id, health);
                continue;
            }

            // 1b. Arming Logic (Mines)
            if (projectile.projectileType === ProjectileType.MINE && !projectile.isArmed) {
                projectile.armTimer += dt;
                if (projectile.armTimer >= 1.0) {
                    projectile.isArmed = true;
                }
            }

            // 2. Guided Missile Logic
            if (projectile.projectileType === ProjectileType.MISSILE) {
                if (extendedLogs) console.log(`[ProjectileSystem] Processing Missile ${id}. Target: ${projectile.targetId || 'None'}`);
                this.updateMissileGuidance(id, dt, transform, physics, projectile, entityManager, extendedLogs);
            }

            // 3. World Collision (Raycasting from prev to current)
            const oldX = transform.prevX || transform.x;
            const oldY = transform.prevY || transform.y;
            const dx = transform.x - oldX;
            const dy = transform.y - oldY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 0.1) {
                const angle = Math.atan2(dy, dx);
                const hit = this.world.raycast(oldX, oldY, angle, dist);
                const hitBorder = transform.x < 0 || transform.x > this.world.getWidthPixels() ||
                    transform.y < 0 || transform.y > this.world.getHeightPixels();

                if (hit || hitBorder) {
                    const cx = hit ? hit.x : transform.x;
                    const cy = hit ? hit.y : transform.y;
                    this.handleHit(cx, cy, id, projectile, physics, health, 'wall', null, entityManager);
                    continue;
                }
            }

            // 4. Entity Collision via Spatial Grid
            this.checkEntityCollisions(id, transform, physics, projectile, health, entityManager);
        }
    }

    private updateMissileGuidance(id: string, dt: number, transform: TransformComponent, physics: PhysicsComponent, projectile: ProjectileComponent, entityManager: EntityManager, extendedLogs: boolean): void {
        // Dynamic Target Acquisition if no target or target lost
        if (!projectile.targetId) {
            const nearest = this.combatSystem.findNearestTarget(transform.x, transform.y, projectile.shooterId, projectile.trackingRange);
            if (nearest) {
                if (extendedLogs) console.log(`[ProjectileSystem] Missile ${id} acquired new target: ${nearest.id}`);
                projectile.targetId = nearest.id;
            } else {
                // Occasional log to avoid spamming
                if (extendedLogs && Math.random() < 0.01) console.log(`[ProjectileSystem] Missile ${id} searching for target... (none found in range ${projectile.trackingRange})`);
            }
        }

        if (projectile.targetId) {
            const targetTransform = entityManager.getComponent<TransformComponent>(projectile.targetId, 'transform');
            const targetHealth = entityManager.getComponent<HealthComponent>(projectile.targetId, 'health');

            if (targetTransform && (!targetHealth || targetHealth.active)) {
                const dx = targetTransform.x - transform.x;
                const dy = targetTransform.y - transform.y;
                const distSq = dx * dx + dy * dy;

                // Range Check
                if (distSq > projectile.trackingRange * projectile.trackingRange) {
                    if (extendedLogs) console.log(`[ProjectileSystem] Missile ${id} lost target ${projectile.targetId} (out of range)`);
                    projectile.targetId = null;
                    return;
                }

                const targetAngle = Math.atan2(dy, dx);
                const currentVelocityAngle = Math.atan2(physics.vy, physics.vx);

                let angleDiff = targetAngle - currentVelocityAngle;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

                // Clamp turn to prevent erratic behavior and apply turnSpeed
                const maxTurn = projectile.turnSpeed * dt;
                const turn = Math.max(-maxTurn, Math.min(maxTurn, angleDiff));

                const newAngle = currentVelocityAngle + turn;
                const speed = projectile.speed > 0 ? projectile.speed : Math.sqrt(physics.vx * physics.vx + physics.vy * physics.vy);
                physics.vx = Math.cos(newAngle) * speed;
                physics.vy = Math.sin(newAngle) * speed;

                if (extendedLogs) console.log(`[ProjectileSystem] Missile ${id} Turn: ${turn.toFixed(4)}, AngleDiff: ${angleDiff.toFixed(4)}, Speed: ${speed.toFixed(1)}`);
            } else {
                if (extendedLogs) console.log(`[ProjectileSystem] Missile ${id} lost target ${projectile.targetId} (inactive or missing components)`);
                projectile.targetId = null;
            }
        }
    }

    private checkEntityCollisions(id: string, transform: TransformComponent, physics: PhysicsComponent, projectile: ProjectileComponent, health: HealthComponent | undefined, entityManager: EntityManager): void {
        const range = physics.radius * 2;
        const neighbors = this.spatialGrid.retrieve({
            x: transform.x - range,
            y: transform.y - range,
            w: range * 2,
            h: range * 2
        });

        for (const other of neighbors) {
            if (other.id === id) continue;

            // Muzzle protection: skip shooter if too close
            if (other.id === projectile.shooterId) {
                const dx = transform.x - other.x;
                const dy = transform.y - other.y;
                if (dx * dx + dy * dy < 40 * 40) continue;
            }

            const dx = transform.x - other.x;
            const dy = transform.y - other.y;
            const distSq = dx * dx + dy * dy;
            const radSum = physics.radius + other.radius;

            if (distSq < radSum * radSum) {
                if (projectile.projectileType === ProjectileType.MINE && !projectile.isArmed) continue;
                this.handleHit(transform.x, transform.y, id, projectile, physics, health, 'entity', other.id, entityManager);
                break;
            }
        }
    }

    private handleHit(x: number, y: number, id: string, projectile: ProjectileComponent, physics: PhysicsComponent, health: HealthComponent | undefined, hitType: 'wall' | 'entity', targetId: string | null, entityManager: EntityManager): void {
        if (projectile.aoeRadius > 0) {
            this.combatSystem.createExplosion(x, y, projectile.aoeRadius, projectile.damage, projectile.shooterId, projectile.projectileType as any);

            // Still trigger procedural world hit if we hit a wall
            if (hitType === 'wall') {
                this.onWorldHitProcedural(x, y, projectile, physics);
            }
        } else {
            if (hitType === 'entity' && targetId) {
                // REDIRECT: If hit a segment, find the root head
                const rootId = this.findRootId(entityManager, targetId);
                const targetHealth = entityManager.getComponent<HealthComponent>(rootId, 'health');

                if (targetHealth) {
                    let finalDamage = projectile.damage;

                    // Armored Trait Logic (was calculateDamage in CombatSystem)
                    // Note: We use the actual targetId (the segment or head) to check for armor,
                    // as armor can be specific to segments or the head's orientation.
                    const targetAI = entityManager.getComponent<any>(targetId, 'ai');
                    const targetTransform = entityManager.getComponent<TransformComponent>(targetId, 'transform');
                    if (targetAI && targetAI.dossier && targetAI.dossier.traits.includes('armored') && targetTransform) {
                        const dx = x - targetTransform.x;
                        const dy = y - targetTransform.y;
                        const angleToSource = Math.atan2(dy, dx);

                        let diff = angleToSource - targetTransform.rotation;
                        while (diff < -Math.PI) diff += Math.PI * 2;
                        while (diff > Math.PI) diff -= Math.PI * 2;

                        if (Math.abs(diff) < Math.PI / 4) {
                            finalDamage *= 0.3; // 70% reduction
                        }
                    }

                    targetHealth.health -= finalDamage;
                    targetHealth.damageFlash = 0.2;
                    if (targetHealth.health <= 0) {
                        targetHealth.health = 0;
                        targetHealth.active = false;
                    }

                    // Multiplayer Sync for RemotePlayer hits
                    const tag = entityManager.getComponent<any>(rootId, 'tag')?.tag;
                    if (tag === 'remote_player' && projectile.shooterId === 'local') {
                        const mm = (window as any).MultiplayerManagerInstance;
                        if (mm) {
                            mm.broadcast('ph', {
                                id: rootId,
                                damage: finalDamage,
                                killerId: 'local'
                            });
                        }
                    }
                }
            } else {
                this.onWorldHitProcedural(x, y, projectile, physics);
            }

            EventBus.getInstance().emit(GameEvent.PROJECTILE_HIT, {
                x, y,
                projectileType: projectile.projectileType,
                hitType
            });
        }

        this.deactivateEntity(id, health);
    }

    /**
     * Follows the chain of SegmentComponents to find the non-segment root (the head).
     */
    private findRootId(entityManager: EntityManager, id: string): string {
        let currentId = id;
        let visited = new Set<string>();

        while (visited.size < 100) { // Safety cap for circular dependencies
            if (visited.has(currentId)) break;
            visited.add(currentId);

            const segment = entityManager.getComponent<SegmentComponent>(currentId, 'segment');
            if (segment && segment.leaderId) {
                currentId = segment.leaderId;
            } else {
                break;
            }
        }
        return currentId;
    }

    private metalHitTracker: Map<string, number> = new Map();

    private onWorldHitProcedural(hitX: number, hitY: number, projectile: ProjectileComponent, physics: PhysicsComponent): void {
        const mat = this.heatMap.getMaterialAt(hitX, hitY);
        const subSize = this.heatMap.getTileSize() / 10;

        switch (projectile.projectileType) {
            case ProjectileType.CANNON:
                if (mat === MaterialType.WOOD) {
                    this.heatMap.destroyArea(hitX, hitY, physics.radius, true);
                    EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'wood' });
                } else if (mat === MaterialType.BRICK) {
                    this.heatMap.destroyArea(hitX, hitY, subSize * 2);
                    EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'brick' });
                } else if (mat === MaterialType.STONE) {
                    this.heatMap.destroyArea(hitX, hitY, subSize * 1);
                    EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'stone' });
                } else if (mat === MaterialType.METAL) {
                    const key = `${Math.floor(hitX / 4)},${Math.floor(hitY / 4)}`;
                    const hits = (this.metalHitTracker.get(key) || 0) + 1;
                    if (hits >= 2) {
                        this.heatMap.destroyArea(hitX, hitY, subSize * 1);
                        this.metalHitTracker.delete(key);
                        EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'metal' });
                    } else {
                        this.metalHitTracker.set(key, hits);
                        EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'metal' });
                    }
                }
                break;

            case ProjectileType.ROCKET:
            case ProjectileType.MISSILE:
            case ProjectileType.MINE:
                if (mat === MaterialType.WOOD) {
                    this.heatMap.destroyArea(hitX, hitY, subSize * 20, true);
                    EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'wood' });
                } else if (mat === MaterialType.BRICK) {
                    this.heatMap.destroyArea(hitX, hitY, subSize * 10);
                    EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'brick' });
                } else if (mat === MaterialType.STONE) {
                    this.heatMap.destroyArea(hitX, hitY, subSize * 5);
                    EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'stone' });
                } else if (mat === MaterialType.METAL) {
                    this.heatMap.destroyArea(hitX, hitY, subSize * 3);
                    EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'metal' });
                }
                break;
        }
    }

    private deactivateEntity(id: string, health: HealthComponent | undefined): void {
        if (health) health.active = false;
    }
}
