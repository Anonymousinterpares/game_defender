import { Component } from './Component';
import { ECSEntity, EntityID } from './Entity';

export class EntityManager {
    private entities: Map<EntityID, ECSEntity> = new Map();
    private components: Map<string, Map<EntityID, Component>> = new Map();

    public createEntity(): ECSEntity {
        const entity = new ECSEntity();
        this.entities.set(entity.id, entity);
        return entity;
    }

    public removeEntity(id: EntityID): void {
        this.entities.delete(id);
        this.components.forEach(compMap => compMap.delete(id));
    }

    public addComponent(entityId: EntityID, component: Component): void {
        if (!this.components.has(component.type)) {
            this.components.set(component.type, new Map());
        }
        this.components.get(component.type)!.set(entityId, component);
    }

    public removeComponent(entityId: EntityID, componentType: string): void {
        this.components.get(componentType)?.delete(entityId);
    }

    public getComponent<T extends Component>(entityId: EntityID, componentType: string): T | undefined {
        return this.components.get(componentType)?.get(entityId) as T;
    }

    public hasComponent(entityId: EntityID, componentType: string): boolean {
        return this.components.get(componentType)?.has(entityId) || false;
    }

    public query(requiredTypes: string[]): EntityID[] {
        if (requiredTypes.length === 0) return Array.from(this.entities.keys());

        // Start with the smallest set for optimization
        let result: EntityID[] = [];
        let minSize = Infinity;
        let smallestType = '';

        for (const type of requiredTypes) {
            const compMap = this.components.get(type);
            if (!compMap) return []; // If any required component type has no entities, result is empty
            if (compMap.size < minSize) {
                minSize = compMap.size;
                smallestType = type;
            }
        }

        const smallestMap = this.components.get(smallestType)!;
        result = Array.from(smallestMap.keys());

        for (const type of requiredTypes) {
            if (type === smallestType) continue;
            const compMap = this.components.get(type)!;
            result = result.filter(id => compMap.has(id));
        }

        return result;
    }

    public clear(): void {
        this.entities.clear();
        this.components.clear();
    }
}
