import { Component } from '../Component';

export class HealthComponent implements Component {
    public readonly type = 'health';
    constructor(
        public health: number = 100,
        public maxHealth: number = 100,
        public damageFlash: number = 0,
        public visualScale: number = 1.0,
        public active: boolean = true
    ) {}
}
