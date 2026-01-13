export type EntityID = string;

export class ECSEntity {
    constructor(public id: EntityID = Math.random().toString(36).substr(2, 9)) { }
}
