import { Component } from '../Component';

export type RenderType = 'player' | 'enemy' | 'projectile' | 'drop' | 'custom';

export class RenderComponent implements Component {
    public readonly type = 'render';
    constructor(
        public renderType: RenderType,
        public color: string = '#fff',
        public radius: number = 10,
        public renderFn?: (ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, scale: number) => void
    ) {}
}