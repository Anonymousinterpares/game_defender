import { Component } from '../Component';

export class FireComponent implements Component {
    public readonly type = 'fire';
    constructor(
        public isOnFire: boolean = false,
        public fireTimer: number = 0,
        public extinguishChance: number = 0.5
    ) {}
}
