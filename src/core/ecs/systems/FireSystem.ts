import { EntityManager } from '../EntityManager';
import { System } from '../System';
import { FireComponent } from '../components/FireComponent';
import { HealthComponent } from '../components/HealthComponent';
import { ConfigManager } from '../../../config/MasterConfig';

export class FireSystem implements System {
    update(dt: number, entityManager: EntityManager): void {
        const entityIds = entityManager.query(['fire', 'health']);
        const config = ConfigManager.getInstance();
        const fireDPS = config.get<number>('Fire', 'dps');
        const baseExtinguishChance = config.get<number>('Fire', 'baseExtinguishChance');

        for (const id of entityIds) {
            const fire = entityManager.getComponent<FireComponent>(id, 'fire')!;
            const health = entityManager.getComponent<HealthComponent>(id, 'health')!;

            // Update visual feedback timers (moved from Entity)
            if (health.damageFlash > 0) health.damageFlash -= dt;
            if (health.visualScale > 1.0) {
                health.visualScale -= dt * 1.0;
                if (health.visualScale < 1.0) health.visualScale = 1.0;
            }

            if (!fire.isOnFire) continue;

            fire.fireTimer += dt;
            
            // Apply Damage
            health.health -= fireDPS * dt;
            if (health.health <= 0) {
                health.health = 0;
                health.active = false;
            }

            // Extinguish logic every 1000ms
            if (fire.fireTimer >= 1.0) {
                fire.fireTimer -= 1.0;
                if (Math.random() < fire.extinguishChance) {
                    fire.isOnFire = false;
                    fire.extinguishChance = baseExtinguishChance;
                } else {
                    fire.extinguishChance = Math.min(1.0, fire.extinguishChance + 0.1);
                }
            }
        }
    }
}
