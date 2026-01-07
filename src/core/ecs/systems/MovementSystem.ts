import { EntityManager } from '../EntityManager';
import { System } from '../System';
import { TransformComponent } from '../components/TransformComponent';
import { PhysicsComponent } from '../components/PhysicsComponent';

export class MovementSystem implements System {
    update(dt: number, entityManager: EntityManager): void {
        const entityIds = entityManager.query(['transform', 'physics']);
        
        for (const id of entityIds) {
            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const physics = entityManager.getComponent<PhysicsComponent>(id, 'physics')!;

            if (physics.isStatic) continue;

            transform.prevX = transform.x;
            transform.prevY = transform.y;

            transform.x += physics.vx * dt;
            transform.y += physics.vy * dt;
        }
    }
}
