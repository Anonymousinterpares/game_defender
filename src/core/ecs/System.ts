import { EntityManager } from './EntityManager';

export interface System {
    readonly id: string;
    update(dt: number, entityManager: EntityManager, inputManager?: any): void;
}
