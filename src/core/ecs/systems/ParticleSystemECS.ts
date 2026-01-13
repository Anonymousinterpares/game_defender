import { System } from '../System';
import { EntityManager } from '../EntityManager';
import { ParticleSystem, ParticleTarget } from '../../ParticleSystem';
import { TransformComponent } from '../components/TransformComponent';
import { PhysicsComponent } from '../components/PhysicsComponent';
import { HealthComponent } from '../components/HealthComponent';
import { FireComponent } from '../components/FireComponent';
import { TagComponent } from '../components/TagComponent';
import { World } from '../../World';
import { MultiplayerManager, NetworkMessageType } from '../../MultiplayerManager';

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

        const ps = ParticleSystem.getInstance();
        ps.update(dt, this.world, playerTarget, enemyTargets);

        const events = ps.consumeEvents();
        this.processEvents(events, playerIds, enemyIds, entityManager);
    }

    private processEvents(events: any, playerIds: string[], enemyIds: string[], entityManager: EntityManager): void {
        events.damageEvents.forEach((ev: any) => {
            const id = ev.targetIdx === -1 ? playerIds[0] : enemyIds[ev.targetIdx];
            if (!id) return;

            const health = entityManager.getComponent<HealthComponent>(id, 'health');
            if (health) {
                health.health -= ev.damage;
                health.damageFlash = 0.2;
                if (health.health <= 0) {
                    health.health = 0;
                    health.active = false;
                }
            }

            if (Math.random() < 0.2) {
                const fire = entityManager.getComponent<FireComponent>(id, 'fire');
                if (fire) fire.isOnFire = true;

                if (ev.targetIdx === -1) {
                    const mm = (window as any).MultiplayerManagerInstance;
                    if (mm && mm.myId && mm.myId !== 'pending') {
                        mm.broadcast(NetworkMessageType.PLAYER_HIT, {
                            id: mm.myId,
                            damage: 0,
                            killerId: 'molten_particle',
                            ignite: true
                        });
                    }
                }
            }
        });

        events.heatEvents.forEach((ev: any) => {
            const heatMap = this.world.getHeatMap();
            if (heatMap) {
                heatMap.addHeat(ev.x, ev.y, ev.intensity, ev.radius);
            }
        });
    }

    private mapToTarget(id: string, entityManager: EntityManager): ParticleTarget | null {
        const transform = entityManager.getComponent<TransformComponent>(id, 'transform');
        const physics = entityManager.getComponent<PhysicsComponent>(id, 'physics');
        const health = entityManager.getComponent<HealthComponent>(id, 'health');
        const fire = entityManager.getComponent<FireComponent>(id, 'fire');

        if (!transform || !physics) return null;

        return {
            x: transform.x,
            y: transform.y,
            radius: physics.radius,
            active: health ? health.active : true,
            isOnFire: fire ? fire.isOnFire : false
        };
    }
}
