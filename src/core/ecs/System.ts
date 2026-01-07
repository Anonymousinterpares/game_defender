import { EntityManager } from './EntityManager';

export interface System {
    update(dt: number, entityManager: EntityManager): void;
}
