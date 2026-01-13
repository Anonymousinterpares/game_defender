import { System } from "../System";
import { EntityManager } from "../EntityManager";
import { TransformComponent } from "../components/TransformComponent";
import { SegmentComponent } from "../components/SegmentComponent";

export class PlayerSegmentSystem implements System {
    public readonly id = 'player_segment_system';

    update(dt: number, entityManager: EntityManager): void {
        const entities = entityManager.query(['transform', 'segment']);

        // To avoid 1-frame lag in chains, we can't just iterate in query order 
        // unless we ensure the order matches the chain.
        // For now, let's just do the simple iteration. 
        // If lag is noticeable, we can optimize by following the leader links recursively.

        for (const id of entities) {
            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const segment = entityManager.getComponent<SegmentComponent>(id, 'segment')!;

            const leaderTransform = entityManager.getComponent<TransformComponent>(segment.leaderId, 'transform');
            if (!leaderTransform) continue;

            const dx = leaderTransform.x - transform.x;
            const dy = leaderTransform.y - transform.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist !== 0) {
                const diff = dist - segment.spacing;

                // Simple constraint: move towards leader
                const moveX = (dx / dist) * diff;
                const moveY = (dy / dist) * diff;

                transform.x += moveX;
                transform.y += moveY;

                // Also update rotation to face the leader? 
                // The legacy code didn't do this for segments, 
                // but usually segments in snake games rotate.
                // Looking at RenderSystem, it uses rotation.
                transform.rotation = Math.atan2(dy, dx);
            }
        }
    }
}
