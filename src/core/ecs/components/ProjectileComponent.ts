import { Component } from "../Component";
export { ProjectileType } from "../../../entities/Projectile";
import { ProjectileType } from "../../../entities/Projectile";

export class ProjectileComponent implements Component {
    public readonly type = 'projectile';

    constructor(
        public projectileType: ProjectileType = ProjectileType.CANNON,
        public damage: number = 10,
        public lifeTime: number = 2.0,
        public shooterId: string | null = null,
        public aoeRadius: number = 0,
        public isArmed: boolean = true,
        public armTimer: number = 0,
        public targetId: string | null = null,
        public turnSpeed: number = 0,
        public trackingRange: number = 50,
        public speed: number = 0
    ) { }
}
