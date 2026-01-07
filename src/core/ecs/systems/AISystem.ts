import { System } from "../System";
import { EntityManager } from "../EntityManager";
import { AIComponent, AIType } from "../components/AIComponent";
import { TransformComponent } from "../components/TransformComponent";
import { PhysicsComponent } from "../components/PhysicsComponent";
import { TagComponent } from "../components/TagComponent";

export class AISystem implements System {
    public readonly id = 'ai';

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
            const ai = entityManager.getComponent<AIComponent>(id, 'ai')!;
            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const physics = entityManager.getComponent<PhysicsComponent>(id, 'physics')!;

            if (ai.aiType === AIType.CHASE) {
                const dx = playerTransform.x - transform.x;
                const dy = playerTransform.y - transform.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist > 0) {
                    physics.vx = (dx / dist) * ai.speed;
                    physics.vy = (dy / dist) * ai.speed;
                    transform.rotation = Math.atan2(dy, dx);
                }
            }
        }
    }
}
