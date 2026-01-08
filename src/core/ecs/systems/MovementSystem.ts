import { EntityManager } from '../EntityManager';
import { System } from '../System';
import { TransformComponent } from '../components/TransformComponent';
import { PhysicsComponent } from '../components/PhysicsComponent';
import { InputComponent } from '../components/InputComponent';
import { ConfigManager } from '../../../config/MasterConfig';

import { TagComponent } from '../components/TagComponent';

export class MovementSystem implements System {
    public readonly id = 'movement';

    update(dt: number, entityManager: EntityManager): void {
        const config = ConfigManager.getInstance();
        const baseSpeed = config.get<number>('Player', 'baseSpeed') || 5.0;
        const turnSpeed = config.get<number>('Player', 'turnSpeed') || 3.0;
        const friction = config.get<number>('Physics', 'friction') || 0.9;
        const tileSize = config.get<number>('World', 'tileSize') || 32;

        const entityIds = entityManager.query(['transform', 'physics']);
        
        for (const id of entityIds) {
            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const physics = entityManager.getComponent<PhysicsComponent>(id, 'physics')!;
            const input = entityManager.getComponent<InputComponent>(id, 'input');
            const tag = entityManager.getComponent<TagComponent>(id, 'tag');

            if (physics.isStatic) continue;

            // Handle Input-based movement (Player)
            if (input) {
                // Only use keyboard turn if NOT player (e.g. maybe other controllable entities)
                // For player, we let the Mouse logic in Player.update() handle rotation
                if (tag?.tag !== 'player') {
                    transform.rotation += input.turn * turnSpeed * dt;
                }

                // Acceleration
                if (input.throttle !== 0) {
                    const speedPx = baseSpeed * tileSize;
                    physics.vx += Math.cos(transform.rotation) * input.throttle * speedPx * dt * 5;
                    physics.vy += Math.sin(transform.rotation) * input.throttle * speedPx * dt * 5;
                }

                // Apply friction
                physics.vx *= friction;
                physics.vy *= friction;
            }

            transform.prevX = transform.x;
            transform.prevY = transform.y;

            transform.x += physics.vx * dt;
            transform.y += physics.vy * dt;
        }
    }
}
