import { System } from '../System';
import { EntityManager } from '../EntityManager';
import { ParticleSystem, ParticleTarget } from '../../ParticleSystem';
import { TransformComponent } from '../components/TransformComponent';
import { PhysicsComponent } from '../components/PhysicsComponent';
import { HealthComponent } from '../components/HealthComponent';
import { FireComponent } from '../components/FireComponent';
import { TagComponent } from '../components/TagComponent';
import { World } from '../../World';

export class ParticleSystemECS implements System {
    public readonly id = 'particle_system_ecs';
    private world: World;

    constructor(world: World) {
        this.world = world;
    }

    public update(dt: number, entityManager: EntityManager): void {
        const playerIds = entityManager.query(['tag']).filter(id => {
            const tag = entityManager.getComponent<TagComponent>(id, 'tag');
            return tag?.tag === 'player';
        });

        const enemyIds = entityManager.query(['tag']).filter(id => {
            const tag = entityManager.getComponent<TagComponent>(id, 'tag');
            return tag?.tag === 'enemy';
        });

        const playerTarget = playerIds.length > 0 ? this.mapToTarget(playerIds[0], entityManager) : null;
        const enemyTargets = enemyIds.map(id => this.mapToTarget(id, entityManager)).filter(t => t !== null) as ParticleTarget[];

        ParticleSystem.getInstance().update(dt, this.world, playerTarget, enemyTargets);
    }

    private mapToTarget(id: string, entityManager: EntityManager): ParticleTarget | null {
        const transform = entityManager.getComponent<TransformComponent>(id, 'transform');
        const physics = entityManager.getComponent<PhysicsComponent>(id, 'physics');
        const health = entityManager.getComponent<HealthComponent>(id, 'health');

        if (!transform || !physics) return null;

        // Note: health might be missing for some entities, but ParticleSystem handles it as optional
        return {
            x: transform.x,
            y: transform.y,
            radius: physics.radius,
            active: health ? health.active : true,
            takeDamage: (dmg: number) => {
                const h = entityManager.getComponent<HealthComponent>(id, 'health');
                if (h) {
                    h.health -= dmg;
                    h.damageFlash = 0.2;
                    if (h.health <= 0) {
                        h.health = 0;
                        h.active = false;
                    }
                }
            },
            get isOnFire(): boolean {
                const f = entityManager.getComponent<FireComponent>(id, 'fire');
                return f ? f.isOnFire : false;
            },
            set isOnFire(val: boolean) {
                const f = entityManager.getComponent<FireComponent>(id, 'fire');
                if (f) f.isOnFire = val;
            }
        };
    }
}
