import { Entity } from '../core/Entity';
import { PhysicsBody } from '../core/PhysicsEngine';

export class RemotePlayer extends Entity {
  public targetX: number = 0;
  public targetY: number = 0;
  public targetRotation: number = 0;
  public name: string = '';
  
  public segments: Entity[] = [];
  private bodyLength: number = 5; // Default match Player
  private segmentSpacing: number = 35;

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
    this.prevY = y;
    this.targetX = x;
    this.targetY = y;

    this.initSegments(x, y);
  }

  private initSegments(x: number, y: number) {
    this.segments = [];
    for (let i = 0; i < this.bodyLength; i++) {
      const seg = new class extends Entity {
          constructor(px: number, py: number, r: number) {
              super(px, py);
              this.radius = r;
          }
          update(dt: number) {}
          render(ctx: CanvasRenderingContext2D) {}
      }(x - (i + 1) * this.segmentSpacing, y, this.radius);
      
      this.segments.push(seg);
    }
  }

  public getAllBodies(): PhysicsBody[] {
      return [this, ...this.segments];
  }

  public updateFromNetwork(x: number, y: number, rotation: number, name?: string, health?: number): void {
    // Set previous to current for interpolation
    this.prevX = this.x;
    this.prevY = this.y;
    
    // Set current to the target we just received
    this.targetX = x;
    this.targetY = y;
    this.targetRotation = rotation;
    if (name) this.name = name;
    if (health !== undefined) {
        if (health < this.health) {
            this.damageFlash = 0.2;
            this.visualScale = 1.2;
        }
        this.health = health;
    }
  }

  update(dt: number): void {
    // Smoothly interpolate towards target to handle network jitter
    const lerpFactor = 0.2; 
    
    // We don't update prevX/prevY here for the head because it's updated in updateFromNetwork
    // Wait, updateFromNetwork only sets prevX/prevY when a message arrives.
    // If update() runs multiple times between messages, prevX should be the position from last frame.
    // Actually, GameplayScene uses physics alpha for interpolation.
    // Physics engine updates the logical position, and we render with interpolated.
    // In RemotePlayer, we are LERPING logical position.
    
    // To match Player.ts style:
    this.prevX = this.x;
    this.prevY = this.y;
    this.segments.forEach(s => {
        s.prevX = s.x;
        s.prevY = s.y;
    });

    this.x += (this.targetX - this.x) * lerpFactor;
    this.y += (this.targetY - this.y) * lerpFactor;
    
    // Rotation lerp (handling wrap around)
    let diff = this.targetRotation - this.rotation;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.rotation += diff * lerpFactor;

    this.resolveSegmentConstraints();
  }

  private resolveSegmentConstraints(): void {
      // Inverse Kinematics / Relaxed Constraints
      let leader = this as PhysicsBody;
      
      for (let i = 0; i < this.segments.length; i++) {
          const segment = this.segments[i];
          
          const dx = leader.x - segment.x;
          const dy = leader.y - segment.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          if (dist !== 0) {
              const diff = dist - this.segmentSpacing;
              const moveX = (dx / dist) * diff;
              const moveY = (dy / dist) * diff;
              
              segment.x += moveX;
              segment.y += moveY;
          }
          
          leader = segment;
      }
  }

  render(ctx: CanvasRenderingContext2D): void {
    // Draw Segments first (behind head)
    for (let i = this.segments.length - 1; i >= 0; i--) {
        const s = this.segments[i];
        const sx = s.interpolatedX;
        const sy = s.interpolatedY;

        ctx.beginPath();
        ctx.arc(sx, sy, this.radius, 0, Math.PI * 2);
        
        // Simple gradient for remote segments
        const grad = ctx.createRadialGradient(sx - 5, sy - 5, 2, sx, sy, this.radius);
        grad.addColorStop(0, '#fff'); 
        grad.addColorStop(0.5, this.color); 
        grad.addColorStop(1, '#000'); 
        ctx.fillStyle = grad;
        ctx.fill();
        
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    const ix = this.interpolatedX;
    const iy = this.interpolatedY;

    // Head
    ctx.save();
    ctx.translate(ix, iy);
    ctx.rotate(this.rotation);

    // Cannon (under head)
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(25, 0);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 6;
    ctx.stroke();
    
    ctx.restore();

    ctx.beginPath();
    ctx.arc(ix, iy, this.radius, 0, Math.PI * 2);
    
    const headGrad = ctx.createRadialGradient(ix - 5, iy - 5, 2, ix, iy, this.radius);
    headGrad.addColorStop(0, '#fff');
    headGrad.addColorStop(0.5, this.color);
    headGrad.addColorStop(1, '#000');
    ctx.fillStyle = headGrad;
    ctx.fill();

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Display Name above head
    ctx.fillStyle = this.color;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.fillText(this.name, ix, iy - 30);
    ctx.shadowBlur = 0;

    // Health Bar
    const hbW = 40;
    const hbH = 4;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(ix - hbW/2, iy - 25, hbW, hbH);
    ctx.fillStyle = this.health > 30 ? '#0f0' : '#f00';
    ctx.fillRect(ix - hbW/2, iy - 25, hbW * (this.health / this.maxHealth), hbH);
  }
}
