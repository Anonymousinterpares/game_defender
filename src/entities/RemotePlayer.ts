import { Entity, PhysicsBody } from '../core/Entity';
import { ConfigManager } from '../config/MasterConfig';
import { NetworkMessageType } from '../core/MultiplayerManager';
import { AssetRegistry } from '../core/AssetRegistry';

export class RemotePlayer extends Entity {
  public targetX: number = 0;
  public targetY: number = 0;
  public targetRotation: number = 0;
  public name: string = '';

  public segments: Entity[] = [];
  private bodyLength: number = ConfigManager.getInstance().get<number>('Player', 'bodyLength');
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
    this.isStatic = true; // IMPORTANT: Prevent PhysicsEngine from moving the head

    this.initSegments(x, y);
  }

  public setBodyLength(length: number): void {
    if (this.segments.length === length) return;
    this.bodyLength = length;
    this.initSegments(this.x, this.y);
  }

  private initSegments(x: number, y: number) {
    this.segments = [];
    for (let i = 0; i < this.bodyLength; i++) {
      const seg = new class extends Entity {
        constructor(px: number, py: number, r: number) {
          super(px, py);
          this.radius = r;
        }
        update(dt: number) { }
        render(ctx: CanvasRenderingContext2D, alpha?: number) { }
      }(x, y, this.radius);

      this.segments.push(seg);
    }
  }

  public getAllBodies(): PhysicsBody[] {
    return [this, ...this.segments];
  }

  public updateFromNetwork(x: number, y: number, rotation: number, name?: string, health?: number): void {
    // Set target for LERP in update()
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
    // Smoother interpolation for the head logical position
    // STAGE 2 FIX: Time-Independent Interpolation
    // Previous fixed factor (0.2) caused desync at different frame rates.
    // Using 1.0 - exp(-decay * dt) matches dampening to time.
    const smoothing = 15.0; // Tuned for snappy but smooth updates
    const factor = 1.0 - Math.exp(-smoothing * dt);

    this.x += (this.targetX - this.x) * factor;
    this.y += (this.targetY - this.y) * factor;

    let diff = this.targetRotation - this.rotation;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.rotation += diff * factor;

    // We DO NOT call resolveSegmentConstraints here anymore because 
    // segments are strictly updated from network state in MultiplayerGameplayScene.
  }

  render(ctx: CanvasRenderingContext2D, alpha: number = 0): void {
    // Draw Segments first (behind head)
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i];
      const sx = s.prevX + (s.x - s.prevX) * alpha;
      const sy = s.prevY + (s.y - s.prevY) * alpha;

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

      // Render fire on segment if burning
      if (s.isOnFire) {
        this.renderFire(ctx, sx, sy, s.radius, s.id);
      }
    }

    const ix = this.prevX + (this.x - this.prevX) * alpha;
    const iy = this.prevY + (this.y - this.prevY) * alpha;

    // Render fire on head if burning
    if (this.isOnFire) {
      this.renderFire(ctx, ix, iy, this.radius, this.id);
    }

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
    ctx.fillRect(ix - hbW / 2, iy - 25, hbW, hbH);
    ctx.fillStyle = this.health > 30 ? '#0f0' : '#f00';
    ctx.fillRect(ix - hbW / 2, iy - 25, hbW * (this.health / this.maxHealth), hbH);
  }

  private renderFire(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, id: string): void {
    try {
      const fireAsset = AssetRegistry.getInstance().getImage('fire_spritesheet');
      if (!fireAsset || !fireAsset.complete || fireAsset.naturalWidth === 0) return;

      const time = performance.now() * 0.001;
      const frameCount = 8;
      const idHash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const frame = Math.floor((time * 15 + idHash) % frameCount);

      const fw = fireAsset.width / frameCount;
      const fh = fireAsset.height;
      const fx = frame * fw;

      const displaySize = radius * 2.5;
      ctx.drawImage(
        fireAsset,
        fx, 0, fw, fh,
        x - displaySize / 2,
        y - displaySize * 0.8,
        displaySize,
        displaySize
      );
    } catch (e) {
      // Asset not loaded
    }
  }
}