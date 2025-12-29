import { PhysicsBody, PhysicsEngine } from './PhysicsEngine';

export abstract class Entity implements PhysicsBody {
  public id: string = Math.random().toString(36).substr(2, 9);
  public x: number = 0;
  public y: number = 0;
  public vx: number = 0;
  public vy: number = 0;
  public radius: number = 10;
  public isStatic: boolean = false;
  public color: string = '#fff';
  public rotation: number = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  abstract update(dt: number): void;
  abstract render(ctx: CanvasRenderingContext2D): void;
}
