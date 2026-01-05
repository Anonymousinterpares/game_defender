import { Entity } from '../core/Entity';

export class RemotePlayer extends Entity {
  public targetX: number = 0;
  public targetY: number = 0;
  public targetRotation: number = 0;
  public name: string = '';

  constructor(id: string, x: number, y: number) {
    super(x, y);
    this.id = id;
    this.name = id.split('-')[1] || id; // Default to ID part
    
    // Generate unique color from ID
    let hash = 0;
    for (let i = 0; i < this.id.length; i++) {
        hash = this.id.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    this.color = '#' + '00000'.substring(0, 6 - c.length) + c;
    
    this.radius = 15;
    this.prevX = x;
    this.prevY = x;
    this.targetX = x;
    this.targetY = y;
  }

  public updateFromNetwork(x: number, y: number, rotation: number, name?: string): void {
    // Set previous to current for interpolation
    this.prevX = this.x;
    this.prevY = this.y;
    
    // Set current to the target we just received
    this.targetX = x;
    this.targetY = y;
    this.targetRotation = rotation;
    if (name) this.name = name;
    
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
    // Use generated color for gradients
    headGrad.addColorStop(0, '#fff');
    headGrad.addColorStop(0.5, this.color);
    headGrad.addColorStop(1, '#000'); // darker edge
    ctx.fillStyle = headGrad;
    ctx.fill();

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
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
    
    // Display Name above head
    ctx.fillStyle = this.color;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.fillText(this.name, ix, iy - 25);
    ctx.shadowBlur = 0;
  }
}
