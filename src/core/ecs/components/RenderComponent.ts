import { Component } from '../Component';

export type RenderType = 'player' | 'player_segment' | 'enemy' | 'projectile' | 'drop' | 'custom';

export class RenderComponent implements Component {
    public readonly type = 'render';
    constructor(
        public renderType: RenderType,
        public color: string = '#fff',
        public radius: number = 10,
        public renderFn?: (ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, scale: number) => void,
        public visualScale: number = 1.0,
        public damageFlash: number = 0,
        public assetId?: string
    ) {}
}