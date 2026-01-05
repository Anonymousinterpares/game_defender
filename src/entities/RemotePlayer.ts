import { Entity } from '../core/Entity';

export class RemotePlayer extends Entity {
  public targetX: number = 0;
  public targetY: number = 0;
  public targetRotation: number = 0;

  constructor(id: string, x: number, y: number) {
    super(x, y);
    this.id = id;
    this.color = '#00ffff'; // Different color for remote players
    this.radius = 15;
    this.prevX = x;
    this.prevY = x;
    this.targetX = x;
    this.targetY = y;
  }

  public updateFromNetwork(x: number, y: number, rotation: number): void {
    // Set previous to current for interpolation
    this.prevX = this.x;
    this.prevY = this.y;
    
    // Set current to the target we just received
    this.targetX = x;
    this.targetY = y;
    this.targetRotation = rotation;
    
    // We don't snap this.x/y yet, we let update() slide them
  }

  update(dt: number): void {
    // Smoothly interpolate towards target to handle network jitter
    // This is a simple lerp. In Phase 3 we can make it more advanced.
    const lerpFactor = 0.2; 
    this.x += (this.targetX - this.x) * lerpFactor;
    this.y += (this.targetY - this.y) * lerpFactor;
    
    // Rotation lerp (handling wrap around)
    let diff = this.targetRotation - this.rotation;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.rotation += diff * lerpFactor;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const ix = this.interpolatedX;
    const iy = this.interpolatedY;

    // Head
    ctx.save();
    ctx.beginPath();
    ctx.arc(ix, iy, this.radius, 0, Math.PI * 2);
    
    const headGrad = ctx.createRadialGradient(ix - 5, iy - 5, 2, ix, iy, this.radius);
    headGrad.addColorStop(0, '#80ffff');
    headGrad.addColorStop(0.5, '#00cccc');
    headGrad.addColorStop(1, '#006666');
    ctx.fillStyle = headGrad;
    ctx.fill();

    ctx.strokeStyle = '#004444';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Cannon
    ctx.translate(ix, iy);
    ctx.rotate(this.rotation);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(25, 0);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.restore();
    
    // Display ID above head
    ctx.fillStyle = '#0f0';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.id.split('-')[1] || this.id, ix, iy - 20);
  }
}
