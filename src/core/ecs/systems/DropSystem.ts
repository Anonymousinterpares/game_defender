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
        const playerIds = entityManager.query(['tag', 'transform']).filter(id => {
            const tag = entityManager.getComponent<TagComponent>(id, 'tag')?.tag;
            return tag === 'player' || tag === 'remote_player';
        });
        if (playerIds.length === 0) return;

        const dropIds = entityManager.query(['drop', 'transform']);

        for (const dropId of dropIds) {
            const drop = entityManager.getComponent<DropComponent>(dropId, 'drop')!;
            if (drop.collected) continue;

            const dropTransform = entityManager.getComponent<TransformComponent>(dropId, 'transform')!;
            drop.bobTime += dt * 5;

            for (const playerId of playerIds) {
                const playerTransform = entityManager.getComponent<TransformComponent>(playerId, 'transform')!;
                const dx = playerTransform.x - dropTransform.x;
                const dy = playerTransform.y - dropTransform.y;
                const distSq = dx * dx + dy * dy;

                if (distSq < 30 * 30) {
                    drop.collected = true;

                    // Rewards (only for local player)
                    const tag = entityManager.getComponent<TagComponent>(playerId, 'tag')?.tag;
                    if (tag === 'player' && drop.dropType === DropType.COIN) {
                        this.collector.coinsCollected += drop.value;
                    }

                    // Events
                    EventBus.getInstance().emit(GameEvent.ITEM_COLLECTED, {
                        x: dropTransform.x,
                        y: dropTransform.y,
                        itemType: drop.dropType,
                        collectorId: playerId, // The actual entity that collected it
                        dropId: dropId
                    });

                    // Deactivate immediately
                    const health = entityManager.getComponent<HealthComponent>(dropId, 'health');
                    if (health) {
                        health.active = false;
                    }
                    break; // Move to next drop
                }
            }
        }
    }
}
