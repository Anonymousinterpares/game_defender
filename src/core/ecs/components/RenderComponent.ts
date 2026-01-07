import { Component } from '../Component';

export type RenderCallback = (ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, scale: number) => void;

export class RenderComponent implements Component {
    public readonly type = 'render';
    constructor(
        public renderFn: RenderCallback,
        public color: string = '#fff'
    ) {}
}
