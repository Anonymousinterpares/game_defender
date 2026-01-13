import { System } from "../System";
import { EntityManager } from "../EntityManager";
import { TransformComponent } from "../components/TransformComponent";
import { TagComponent } from "../components/TagComponent";
import { DropComponent, DropType } from "../components/DropComponent";
import { HealthComponent } from "../components/HealthComponent";
import { EventBus, GameEvent } from "../../EventBus";

export interface DropCollector {
    coinsCollected: number;
    myId: string;
}

export class DropSystem implements System {
    public readonly id = 'drop_system';

    constructor(private collector: DropCollector) { }

    update(dt: number, entityManager: EntityManager): void {
        const playerIds = entityManager.query(['tag', 'transform']);
        const playerId = playerIds.find(id => entityManager.getComponent<TagComponent>(id, 'tag')?.tag === 'player');
        if (!playerId) return;

        const playerTransform = entityManager.getComponent<TransformComponent>(playerId, 'transform')!;
        const dropIds = entityManager.query(['drop', 'transform']);

        for (const dropId of dropIds) {
            const drop = entityManager.getComponent<DropComponent>(dropId, 'drop')!;
            if (drop.collected) continue;

            const dropTransform = entityManager.getComponent<TransformComponent>(dropId, 'transform')!;

            // Update bobbing animation
            drop.bobTime += dt * 5;

            const dx = playerTransform.x - dropTransform.x;
            const dy = playerTransform.y - dropTransform.y;
            const distSq = dx * dx + dy * dy;

            // Collection radius (approx 30 pixels)
            if (distSq < 30 * 30) {
                drop.collected = true;

                // Rewards
                if (drop.dropType === DropType.COIN) {
                    this.collector.coinsCollected += drop.value;
                }

                // Events
                EventBus.getInstance().emit(GameEvent.ITEM_COLLECTED, {
                    x: dropTransform.x,
                    y: dropTransform.y,
                    itemType: drop.dropType,
                    collectorId: this.collector.myId
                });

                // Deactivate immediately to stop physics and rendering
                const health = entityManager.getComponent<HealthComponent>(dropId, 'health');
                if (health) {
                    health.active = false;
                }
            }
        }
    }
}
