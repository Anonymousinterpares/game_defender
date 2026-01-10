import { Entity } from '../core/Entity';
import { Player } from './Player';
import { ConfigManager } from '../config/MasterConfig';

export class Enemy extends Entity {
  private speed: number = 150;

  constructor(x: number, y: number) {
    super(x, y);
    this.color = '#ff3333'; // Red
    this.radius = 12;
    this.health = 20;
    this.maxHealth = 20;
  }

  update(dt: number, player?: Player): void {
    const fireDPS = ConfigManager.getInstance().get<number>('Fire', 'dps');
    const baseExtinguish = ConfigManager.getInstance().get<number>('Fire', 'baseExtinguishChance');
    this.handleFireLogic(dt, fireDPS, baseExtinguish);

    if (!player || !this.active) return;
  }

  // Deprecated render methods removed. Logic now in RenderSystem.
  render(ctx: CanvasRenderingContext2D, alpha?: number): void {}
}