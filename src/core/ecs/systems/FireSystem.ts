import { EntityManager } from '../EntityManager';
import { System } from '../System';
import { FireComponent } from '../components/FireComponent';
import { HealthComponent } from '../components/HealthComponent';
import { TransformComponent } from '../components/TransformComponent';
import { PhysicsComponent } from '../components/PhysicsComponent';
import { AIComponent } from '../components/AIComponent';
import { ConfigManager } from '../../../config/MasterConfig';

export class FireSystem implements System {
    public readonly id = 'fire';

    update(dt: number, entityManager: EntityManager): void {
        const entityIds = entityManager.query(['fire', 'health', 'transform', 'physics']);
        const config = ConfigManager.getInstance();
        const fireDPS = config.get<number>('Fire', 'dps');
        const baseExtinguishChance = config.get<number>('Fire', 'baseExtinguishChance');
        const catchChance = config.get<number>('Fire', 'catchChance') || 0.1;

        const heatMap = (entityManager as any).heatMap;

        for (const id of entityIds) {
            const fire = entityManager.getComponent<FireComponent>(id, 'fire')!;
            const health = entityManager.getComponent<HealthComponent>(id, 'health')!;
            const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const physics = entityManager.getComponent<PhysicsComponent>(id, 'physics')!;
            const ai = entityManager.getComponent<AIComponent>(id, 'ai');

            // Respect heat_proof trait
            const isHeatProof = ai?.dossier?.traits.includes('heat_proof');

            // 1. Environmental Fire Detection
            if (!fire.isOnFire && heatMap) {
                const isTouchingFire = heatMap.checkFireArea(transform.x, transform.y, physics.radius);
                const heatIntensity = heatMap.getMaxIntensityArea(transform.x, transform.y, physics.radius);
                const moltenIntensity = heatMap.getMaxMoltenArea(transform.x, transform.y, physics.radius);
                
                if ((isTouchingFire || heatIntensity > 0.8 || moltenIntensity > 0.1) && Math.random() < catchChance * dt) {
                    fire.isOnFire = true;
                }
            }

            // 2. Damage & Visual Feedback
            if (health.damageFlash > 0) health.damageFlash -= dt;
            if (health.visualScale > 1.0) {
                health.visualScale -= dt * 1.0;
                if (health.visualScale < 1.0) health.visualScale = 1.0;
            }

            if (!fire.isOnFire) continue;

            if (isHeatProof) {
                fire.isOnFire = false;
                continue;
            }

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
