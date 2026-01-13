import { System } from "../System";
import { EntityManager } from "../EntityManager";
import { TransformComponent } from "../components/TransformComponent";
import { TagComponent } from "../components/TagComponent";
import { DropComponent, DropType } from "../components/DropComponent";
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

                // Deactivate/Remove entity logic will be handled by Simulation or a CleanupSystem
                // For now, we'll mark it for removal by Simulation logic in Phase 3
                // Actually, let's just use a HealthComponent and set active to false for consistency if it has one
                const health = entityManager.getComponent<any>(dropId, 'health');
                if (health) {
                    health.active = false;
                } else {
                    // Fallback: Simulation will check drop.collected
                }
            }
        }
    }
}
