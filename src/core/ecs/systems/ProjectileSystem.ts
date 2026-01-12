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

export class ProjectileSystem implements System {
    public readonly id = 'projectile_system';

    constructor(
        private world: World, 
        private heatMap: HeatMap, 
        private spatialGrid: Quadtree<Entity>,
        private combatSystem: CombatSystem
    ) {}

    update(dt: number, entityManager: EntityManager): void {
        const entities = entityManager.query(['transform', 'physics', 'projectile']);
        
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
            if (projectile.projectileType === ProjectileType.MISSILE && projectile.targetId) {
                this.updateMissileGuidance(dt, transform, physics, projectile, entityManager);
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
                    this.handleHit(cx, cy, id, projectile, health, 'wall', null, entityManager);
                    continue;
                }
            }

            // 4. Entity Collision via Spatial Grid
            this.checkEntityCollisions(id, transform, physics, projectile, health, entityManager);
        }
    }

    private updateMissileGuidance(dt: number, transform: TransformComponent, physics: PhysicsComponent, projectile: ProjectileComponent, entityManager: EntityManager): void {
        const targetTransform = entityManager.getComponent<TransformComponent>(projectile.targetId!, 'transform');
        const targetHealth = entityManager.getComponent<HealthComponent>(projectile.targetId!, 'health');
        
        if (targetTransform && (!targetHealth || targetHealth.active)) {
            const dx = targetTransform.x - transform.x;
            const dy = targetTransform.y - transform.y;
            const targetAngle = Math.atan2(dy, dx);
            
            // We use transform.rotation for target calc, but Invariant A says only Physics writes to it.
            // However, missiles need to update their velocity vector. 
            // PhysicsSystem will then update rotation because alignRotationToVelocity is true.
            
            const currentVelocityAngle = Math.atan2(physics.vy, physics.vx);
            let angleDiff = targetAngle - currentVelocityAngle;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            
            const newAngle = currentVelocityAngle + angleDiff * projectile.turnSpeed * dt;
            const speed = Math.sqrt(physics.vx * physics.vx + physics.vy * physics.vy);
            physics.vx = Math.cos(newAngle) * speed;
            physics.vy = Math.sin(newAngle) * speed;
        } else {
            projectile.targetId = null; 
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
                this.handleHit(transform.x, transform.y, id, projectile, health, 'entity', other.id, entityManager);
                break;
            }
        }
    }

    private handleHit(x: number, y: number, id: string, projectile: ProjectileComponent, health: HealthComponent | undefined, hitType: 'wall' | 'entity', targetId: string | null, entityManager: EntityManager): void {
        if (projectile.aoeRadius > 0) {
            this.combatSystem.createExplosion(x, y, projectile.aoeRadius, projectile.damage, projectile.shooterId, projectile.projectileType as any);
        } else {
            if (hitType === 'entity' && targetId) {
                const targetHealth = entityManager.getComponent<HealthComponent>(targetId, 'health');
                if (targetHealth) {
                    targetHealth.health -= projectile.damage;
                    targetHealth.damageFlash = 0.2;
                    if (targetHealth.health <= 0) {
                        targetHealth.health = 0;
                        targetHealth.active = false;
                    }
                }
            } else {
                this.onWorldHitProcedural(x, y, projectile);
            }

            EventBus.getInstance().emit(GameEvent.PROJECTILE_HIT, { 
                x, y, 
                projectileType: projectile.projectileType, 
                hitType 
            });
        }
        
        this.deactivateEntity(id, health);
    }

    private onWorldHitProcedural(hitX: number, hitY: number, projectile: ProjectileComponent): void {
        const mat = this.heatMap.getMaterialAt(hitX, hitY);
        const subSize = this.heatMap.getTileSize() / 10;

        switch(projectile.projectileType) {
            case ProjectileType.CANNON:
                if (mat === MaterialType.WOOD) {
                    this.heatMap.destroyArea(hitX, hitY, 12, true);
                } else if (mat === MaterialType.BRICK) {
                    this.heatMap.destroyArea(hitX, hitY, subSize * 2);
                } else {
                    this.heatMap.destroyArea(hitX, hitY, subSize * 1);
                }
                break;
            default:
                this.heatMap.destroyArea(hitX, hitY, subSize * 5, true);
                break;
        }
        
        if (mat !== MaterialType.NONE) {
            EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: MaterialType[mat].toLowerCase() });
        }
    }

    private deactivateEntity(id: string, health: HealthComponent | undefined): void {
        if (health) health.active = false;
    }
}
