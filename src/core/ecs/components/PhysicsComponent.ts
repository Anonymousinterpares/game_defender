import { Component } from '../Component';

export class PhysicsComponent implements Component {
    public readonly type = 'physics';
    constructor(
        public vx: number = 0,
        public vy: number = 0,
        public radius: number = 10,
        public isStatic: boolean = false,
        public mass: number = 1.0
    ) {}
}
