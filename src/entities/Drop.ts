import { Entity } from '../core/Entity';

export enum DropType {
  COIN = 'COIN',
  BOOSTER = 'BOOSTER',
  NEGATIVE = 'NEGATIVE'
}

export class Drop extends Entity {
  public type: DropType;
  private bobTime: number = Math.random() * Math.PI * 2;

  constructor(x: number, y: number, type: DropType) {
    super(x, y);
    this.type = type;
    this.isStatic = true; // Drops don't move with physics usually
    
    switch(type) {
      case DropType.COIN: this.color = '#ffd700'; this.radius = 8; break;
      case DropType.BOOSTER: this.color = '#00ffff'; this.radius = 10; break;
      case DropType.NEGATIVE: this.color = '#ff00ff'; this.radius = 10; break;
    }
  }

  update(dt: number): void {
    this.bobTime += dt * 5;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const yOffset = Math.sin(this.bobTime) * 5;
    
    ctx.shadowBlur = 10;
    
    if (this.type === DropType.COIN) {
      // Draw Gear (Coin)
      ctx.shadowColor = '#ffd700';
      ctx.fillStyle = '#cfaa6e'; // Brass gold
      
      ctx.save();
      ctx.translate(this.x, this.y + yOffset);
      ctx.rotate(this.bobTime); // Spin
      
      // Gear shape
      const outer = 8;
      const inner = 5;
      const teeth = 6;
      
      ctx.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
          const angle = (Math.PI * 2 * i) / (teeth * 2);
          const r = (i % 2 === 0) ? outer : inner;
          ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      }
      ctx.closePath();
      ctx.fill();
      
      // Hole in center
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.restore();
      
    } else {
      // Booster (Glowing Crystal)
      ctx.shadowColor = '#00ffff';
      ctx.fillStyle = '#00ffff';
      
      ctx.beginPath();
      ctx.arc(this.x, this.y + yOffset, this.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.shadowBlur = 0; // Reset shadow
  }
}
