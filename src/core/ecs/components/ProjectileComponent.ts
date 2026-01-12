import { Component } from "../Component";

export enum ProjectileType {
    CANNON = 'cannon',
    ROCKET = 'rocket',
    MISSILE = 'missile',
    MINE = 'mine'
}

export class ProjectileComponent implements Component {
    public readonly type = 'projectile';

    constructor(
        public projectileType: ProjectileType = ProjectileType.CANNON,
        public damage: number = 10,
        public lifeTime: number = 2.0,
        public shooterId: string | null = null,
        public aoeRadius: number = 0,
        public isArmed: boolean = true,
        public targetId: string | null = null,
        public turnSpeed: number = 0
    ) {}
}
