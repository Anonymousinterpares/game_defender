import { System } from "../System";
import { EntityManager } from "../EntityManager";
import { TransformComponent } from "../components/TransformComponent";
import { PhysicsComponent } from "../components/PhysicsComponent";
import { AIComponent } from "../components/AIComponent";
import { TagComponent } from "../components/TagComponent";
import { HealthComponent } from "../components/HealthComponent";
import { EventBus, GameEvent } from "../../EventBus";

export class ContactDamageSystem implements System {
    public readonly id = 'contact-damage';
    private damageCooldowns: Map<string, number> = new Map();
    private readonly COOLDOWN = 1.0; // 1 second between contact hits from same enemy

    update(dt: number, entityManager: EntityManager): void {
        const playerIds = entityManager.query(['tag', 'transform', 'health']);
        const playerId = playerIds.find(id => entityManager.getComponent<TagComponent>(id, 'tag')?.tag === 'player');
        if (!playerId) return;

        const playerTransform = entityManager.getComponent<TransformComponent>(playerId, 'transform')!;
        const playerPhysics = entityManager.getComponent<PhysicsComponent>(playerId, 'physics');
        const playerHealth = entityManager.getComponent<HealthComponent>(playerId, 'health')!;
        const playerRadius = playerPhysics?.radius || 15;

        const enemyIds = entityManager.query(['ai', 'transform', 'tag']);
        
        for (const enemyId of enemyIds) {
            const tag = entityManager.getComponent<TagComponent>(enemyId, 'tag');
            if (tag?.tag !== 'enemy') continue;

            const ai = entityManager.getComponent<AIComponent>(enemyId, 'ai')!;
            const transform = entityManager.getComponent<TransformComponent>(enemyId, 'transform')!;
            const physics = entityManager.getComponent<PhysicsComponent>(enemyId, 'physics');
            const enemyRadius = physics?.radius || 12;

            // Update cooldown
            const currentCooldown = this.damageCooldowns.get(enemyId) || 0;
            if (currentCooldown > 0) {
                this.damageCooldowns.set(enemyId, currentCooldown - dt);
                continue;
            }

            // Check collision
            const dx = transform.x - playerTransform.x;
            const dy = transform.y - playerTransform.y;
            const distSq = dx * dx + dy * dy;
            const radSum = playerRadius + enemyRadius;

            if (distSq < radSum * radSum) {
                const damage = ai.dossier?.baseStats.contactDamage || 5;
                playerHealth.health -= damage;
                this.damageCooldowns.set(enemyId, this.COOLDOWN);

                // Apply Knockback / Bounce
                const dist = Math.sqrt(distSq) || 0.1;
                const nx = dx / dist; // Direction from player to enemy
                const ny = dy / dist;
                
                // Professional grade bounce: apply impulse to both
                const bounceStrength = 300;
                if (playerPhysics) {
                    playerPhysics.vx -= nx * bounceStrength * (physics?.mass || 1.0);
                    playerPhysics.vy -= ny * bounceStrength * (physics?.mass || 1.0);
                }
                if (physics) {
                    physics.vx += nx * bounceStrength * 2.0; // Enemies bounce off harder
                    physics.vy += ny * bounceStrength * 2.0;
                }

                // Set AI wait timer to prevent immediate re-charge
                if (ai) {
                    ai.waitTimer = this.COOLDOWN; // Sync with damage cooldown
                }

                // Feedback
                EventBus.getInstance().emit(GameEvent.ENTITY_HIT, {
                    x: playerTransform.x,
                    y: playerTransform.y,
                    damage: damage,
                    targetId: 'local',
                    sourceId: enemyId,
                    color: '#ff0000'
                });

                if (playerHealth.health <= 0) {
                    playerHealth.health = 0;
                    playerHealth.active = false;
                }
            }
        }

        // Cleanup stale cooldowns
        for (const [id, time] of this.damageCooldowns.entries()) {
            if (time <= 0) this.damageCooldowns.delete(id);
        }
    }
}
