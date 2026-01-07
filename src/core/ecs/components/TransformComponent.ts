import { Component } from '../Component';

export class TransformComponent implements Component {
    public readonly type = 'transform';
    constructor(
        public x: number = 0,
        public y: number = 0,
        public rotation: number = 0,
        public prevX: number = 0,
        public prevY: number = 0
    ) {}
}
