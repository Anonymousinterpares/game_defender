import { InputManager } from './InputManager';

export interface Scene {
  onEnter(): void | Promise<void>;
  onExit(): void;
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D): void;
  handleCommand?(cmd: string): boolean;
}
