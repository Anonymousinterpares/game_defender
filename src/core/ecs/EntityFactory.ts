import { EntityManager } from "./EntityManager";
import { TransformComponent } from "./components/TransformComponent";
import { PhysicsComponent } from "./components/PhysicsComponent";
import { HealthComponent } from "./components/HealthComponent";
import { FireComponent } from "./components/FireComponent";
import { RenderComponent } from "./components/RenderComponent";
import { TagComponent } from "./components/TagComponent";
import { InputComponent } from "./components/InputComponent";
import { AIComponent } from "./components/AIComponent";
import { AIBehavior } from "./components/AIDossier";
import { ConfigManager } from "../../config/MasterConfig";

export class EntityFactory {
    public static createPlayer(entityManager: EntityManager, x: number, y: number): string {
        const entity = entityManager.createEntity();
        const id = entity.id;

        const config = ConfigManager.getInstance();
        const maxHealth = config.get<number>('Player', 'maxHealth') || 100;

        entityManager.addComponent(id, new TagComponent('player'));
        entityManager.addComponent(id, new TransformComponent(x, y, 0));
        entityManager.addComponent(id, new PhysicsComponent(0, 0, 15));
        entityManager.addComponent(id, new HealthComponent(maxHealth, maxHealth));
        entityManager.addComponent(id, new FireComponent());
        entityManager.addComponent(id, new RenderComponent('custom', '#cfaa6e', 15));
        entityManager.addComponent(id, new InputComponent());

        return id;
    }

    public static createEnemy(entityManager: EntityManager, x: number, y: number): string {
        const entity = entityManager.createEntity();
        const id = entity.id;

        entityManager.addComponent(id, new TagComponent('enemy'));
        entityManager.addComponent(id, new TransformComponent(x, y, 0));
        entityManager.addComponent(id, new PhysicsComponent(0, 0, 12));
        entityManager.addComponent(id, new HealthComponent(20, 20));
        entityManager.addComponent(id, new FireComponent());
        entityManager.addComponent(id, new RenderComponent('enemy', '#ff3333', 12));
        entityManager.addComponent(id, new AIComponent(AIBehavior.CHASE, null, 150));

        return id;
    }

    public static createProjectile(entityManager: EntityManager, x: number, y: number, angle: number, type: string, shooterId: string): string {
        const entity = entityManager.createEntity();
        const id = entity.id;

        // Simplified projectile for now
        entityManager.addComponent(id, new TagComponent('projectile'));
        entityManager.addComponent(id, new TransformComponent(x, y, angle));
        entityManager.addComponent(id, new PhysicsComponent(Math.cos(angle) * 500, Math.sin(angle) * 500, 5));
        entityManager.addComponent(id, new RenderComponent('custom', '#fff', 5));
        
        return id;
    }
}
