import { EntityManager } from "./EntityManager";
import { TransformComponent } from "./components/TransformComponent";
import { PhysicsComponent } from "./components/PhysicsComponent";
import { HealthComponent } from "./components/HealthComponent";
import { FireComponent } from "./components/FireComponent";
import { RenderComponent } from "./components/RenderComponent";
import { TagComponent } from "./components/TagComponent";
import { InputComponent } from "./components/InputComponent";
import { AIComponent } from "./components/AIComponent";
import { AIBehavior, TRAIT_LIBRARY } from "./components/AIDossier";
import { ConfigManager } from "../../config/MasterConfig";
import { EnemyRegistry } from "../../entities/enemies/EnemyRegistry";

export class EntityFactory {
    public static createPlayer(entityManager: EntityManager, x: number, y: number): string {
        const entity = entityManager.createEntity();
        const id = entity.id;

        const config = ConfigManager.getInstance();
        const maxHealth = config.get<number>('Player', 'maxHealth') || 100;

        entityManager.addComponent(id, new TagComponent('player'));
        entityManager.addComponent(id, new TransformComponent(x, y, 0));
        entityManager.addComponent(id, new PhysicsComponent(0, 0, 15, false, 10.0)); // Player mass 10.0
        entityManager.addComponent(id, new HealthComponent(maxHealth, maxHealth));
        entityManager.addComponent(id, new FireComponent());
        entityManager.addComponent(id, new RenderComponent('player', '#cfaa6e', 15));
        entityManager.addComponent(id, new InputComponent());

        return id;
    }

    public static createEnemy(entityManager: EntityManager, x: number, y: number, type: string = 'Scout'): string {
        const entity = entityManager.createEntity();
        const id = entity.id;

        const registry = EnemyRegistry.getInstance();
        let dossier = registry.get(type);
        if (!dossier) dossier = registry.get('Scout')!;

        // Apply trait modifiers to base stats
        let finalHp = dossier.baseStats.hp;
        let finalSpeed = dossier.baseStats.speed;
        
        dossier.traits.forEach(traitId => {
            const trait = TRAIT_LIBRARY[traitId];
            if (trait && trait.modifiers) {
                if (trait.modifiers.hpMul) finalHp *= trait.modifiers.hpMul;
                if (trait.modifiers.speedMul) finalSpeed *= trait.modifiers.speedMul;
            }
        });

        const isSwamer = dossier.name === 'Scout' || dossier.name === 'Horde Runner';
        const finalMass = dossier.name === 'Heavy' ? 5.0 : (isSwamer ? 0.5 : 1.0);

        entityManager.addComponent(id, new TagComponent('enemy'));
        entityManager.addComponent(id, new TransformComponent(x, y, 0));
        entityManager.addComponent(id, new PhysicsComponent(0, 0, dossier.baseStats.radius, false, finalMass));
        entityManager.addComponent(id, new HealthComponent(finalHp, finalHp));
        entityManager.addComponent(id, new FireComponent());
        entityManager.addComponent(id, new RenderComponent('enemy', dossier.visuals.color, dossier.baseStats.radius));
        
        const aiComp = new AIComponent(dossier.behavior, null, finalSpeed);
        aiComp.dossier = dossier;
        entityManager.addComponent(id, aiComp);

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
