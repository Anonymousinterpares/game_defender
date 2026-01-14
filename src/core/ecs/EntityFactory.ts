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
import { ProjectileComponent, ProjectileType } from "./components/ProjectileComponent";
import { DropComponent, DropType } from "./components/DropComponent";
import { EnemyRegistry } from "../../entities/enemies/EnemyRegistry";
import { WeaponComponent } from "./components/WeaponComponent";

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

        const weapon = new WeaponComponent();
        const weapons = ['cannon', 'rocket', 'missile', 'laser', 'ray', 'mine', 'flamethrower'];
        weapons.forEach(w => {
            const configKey = w === 'laser' || w === 'ray' || w === 'flamethrower' ? 'MaxEnergy' : 'MaxAmmo';
            const max = config.get<number>('Weapons', w + configKey) || 0;
            weapon.ammo.set(w, max);
            weapon.reloading.set(w, false);
            weapon.reloadTimers.set(w, 0);

            // Ensure weapon is unlocked if it has ammo/energy capacity
            if (max > 0) {
                weapon.unlockedWeapons.add(w);
            }
        });
        entityManager.addComponent(id, weapon);

        return id;
    }

    public static createEnemy(entityManager: EntityManager, x: number, y: number, type: string = 'Scout', id?: string): string {
        const entityId = id ? (entityManager.hasEntity(id) ? id : entityManager.createEntityWithId(id).id) : entityManager.createEntity().id;

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

        entityManager.addComponent(entityId, new TagComponent('enemy'));
        entityManager.addComponent(entityId, new TransformComponent(x, y, 0));
        entityManager.addComponent(entityId, new PhysicsComponent(0, 0, dossier.baseStats.radius, false, finalMass));
        entityManager.addComponent(entityId, new HealthComponent(finalHp, finalHp));
        entityManager.addComponent(entityId, new FireComponent());
        entityManager.addComponent(entityId, new RenderComponent('enemy', dossier.visuals.color, dossier.baseStats.radius));

        const aiComp = new AIComponent(dossier.behavior, null, finalSpeed);
        aiComp.dossier = dossier;
        entityManager.addComponent(entityId, aiComp);

        return entityId;
    }

    public static createProjectile(entityManager: EntityManager, x: number, y: number, angle: number, type: ProjectileType, shooterId: string | null): string {
        if (ConfigManager.getInstance().get<boolean>('Debug', 'extendedLogs')) {
            console.log(`[EntityFactory] Creating projectile of type: ${type} for shooter: ${shooterId}`);
        }
        const entity = entityManager.createEntity();
        const id = entity.id;

        const config = ConfigManager.getInstance();
        let damage = 10;
        let speed = 800;
        let radius = 4;
        let aoeRadius = 0;
        let lifeTime = 2.0;
        let turnSpeed = 0;

        switch (type) {
            case ProjectileType.CANNON:
                damage = config.get<number>('Weapons', 'cannonDamage') || 10;
                speed = 800;
                break;
            case ProjectileType.ROCKET:
                damage = config.get<number>('Weapons', 'rocketDamage') || 20;
                speed = 600;
                aoeRadius = (config.get<number>('Weapons', 'rocketAOE') || 2) * (config.get<number>('World', 'tileSize') || 32);
                radius = 6;
                lifeTime = 3.0;
                break;
            case ProjectileType.MISSILE:
                damage = config.get<number>('Weapons', 'missileDamage') || 15;
                const tileSize = config.get<number>('World', 'tileSize') || 32;
                speed = (config.get<number>('Weapons', 'missileSpeed') || 15) * tileSize;
                aoeRadius = (config.get<number>('Weapons', 'missileAOE') || 1.5) * tileSize;
                turnSpeed = config.get<number>('Weapons', 'missileTurnSpeed') || 8.0;
                lifeTime = 5.0;
                break;
            case ProjectileType.MINE:
                damage = config.get<number>('Weapons', 'mineDamage') || 40;
                speed = 0;
                aoeRadius = (config.get<number>('Weapons', 'mineAOE') || 3) * (config.get<number>('World', 'tileSize') || 32);
                radius = 8;
                lifeTime = 30.0;
                break;
        }

        entityManager.addComponent(id, new TagComponent('projectile'));
        entityManager.addComponent(id, new TransformComponent(x, y, angle));
        entityManager.addComponent(id, new PhysicsComponent(
            Math.cos(angle) * speed,
            Math.sin(angle) * speed,
            radius,
            false, 1.0, 0, 0,
            0.0, // Friction multiplier 0.0 for projectiles
            type !== ProjectileType.MINE // Align rotation to velocity
        ));
        entityManager.addComponent(id, new HealthComponent(1, 1)); // Projectiles have 1 HP
        const trackingRange = (type === ProjectileType.MISSILE) ? (config.get<number>('Weapons', 'missileTrackingRange') || 500) : 0;
        entityManager.addComponent(id, new ProjectileComponent(type, damage, lifeTime, shooterId, aoeRadius, type !== ProjectileType.MINE, 0, null, turnSpeed, trackingRange, speed));
        entityManager.addComponent(id, new RenderComponent('projectile', '#fff', radius));

        return id;
    }

    public static createDrop(entityManager: EntityManager, x: number, y: number, type: DropType, id?: string): string {
        const entityId = id ? (entityManager.hasEntity(id) ? id : entityManager.createEntityWithId(id).id) : entityManager.createEntity().id;
        const fid = entityId;

        const radius = type === DropType.COIN ? 8 : 12;
        const value = type === DropType.COIN ? 10 : 0;

        entityManager.addComponent(entityId, new TagComponent('drop'));
        entityManager.addComponent(entityId, new TransformComponent(x, y, 0));
        entityManager.addComponent(entityId, new PhysicsComponent(0, 0, radius, true, 1.0, 0, 0, 1.0, false));
        entityManager.addComponent(entityId, new DropComponent(type, value));
        entityManager.addComponent(entityId, new HealthComponent(1, 1)); // Drops have 1 HP
        entityManager.addComponent(entityId, new RenderComponent('drop', type === DropType.COIN ? '#ffd700' : '#3498db', radius));

        return entityId;
    }
}
