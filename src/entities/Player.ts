import { Entity } from '../core/Entity';
import { PhysicsBody } from '../core/PhysicsEngine';
import { ConfigManager } from '../config/MasterConfig';
import { InputManager } from '../core/InputManager';
import { Upgrade } from './upgrades/Upgrade';

export class Player extends Entity {
  public segments: Entity[] = []; // Treat segments as full Entities for collision
  public upgrades: Map<number, Upgrade> = new Map(); // Index -> Upgrade
  private input: InputManager;
  
  // Stats
  private baseSpeedStat: number = 0;
  private speed: number = 0;
  private turnSpeed: number = 0;
  private bodyLength: number = 2;
  private segmentSpacing: number = 35; // Increased: Radius is 15, so 30 is sum. 35 prevents initial overlap.

  constructor(x: number, y: number, input: InputManager) {
    super(x, y);
    this.input = input;
    this.color = '#cfaa6e';
    this.radius = 15;

    // Load initial config
    this.refreshConfig();

    // Init body segments BEHIND the player
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
          update(dt: number) {} // Managed by player
          render(ctx: CanvasRenderingContext2D) {} // Managed by player
      }(x - (i + 1) * this.segmentSpacing, y, this.radius);
      
      this.segments.push(seg);
    }
  }

  public addSlot(): void {
      this.bodyLength++;
      const last = this.segments[this.segments.length - 1] || this;
      const seg = new class extends Entity {
          constructor(px: number, py: number, r: number) {
              super(px, py);
              this.radius = r;
          }
          update(dt: number) {}
          render(ctx: CanvasRenderingContext2D) {}
      }(last.x, last.y, this.radius);
      this.segments.push(seg);
      
      this.calculateSpeed();
  }

  public refreshConfig(): void {
    this.baseSpeedStat = ConfigManager.getInstance().get<number>('Player', 'baseSpeed');
    this.turnSpeed = ConfigManager.getInstance().get<number>('Player', 'turnSpeed');
    this.maxHealth = ConfigManager.getInstance().get<number>('Player', 'maxHealth');
    // Heal to max if it's the first load or if we want to reset
    if (this.health === 100 && this.maxHealth !== 100) this.health = this.maxHealth;
    
    // We don't overwrite bodyLength from config if it has grown in-game
    // Unless it's the first load
    if (this.segments.length === 0) {
        this.bodyLength = ConfigManager.getInstance().get<number>('Player', 'bodyLength'); 
    }
    this.calculateSpeed();
  }

  private calculateSpeed(): void {
      // Logic: More slots = lower speed
      // penalty: 5% reduction per slot beyond starting 2
      const penalty = Math.max(0.5, 1.0 - (this.bodyLength - 2) * 0.05);
      this.speed = this.baseSpeedStat * 20 * penalty;
  }
  
  // Helper to expose all parts for Physics Engine
  public getAllBodies(): PhysicsBody[] {
      return [this, ...this.segments];
  }

  update(dt: number, enemies: Entity[] = [], spawnProjectile: (x: number, y: number, angle: number) => void = () => {}): void {
    const fireDPS = ConfigManager.getInstance().get<number>('Fire', 'dps');
    const baseExtinguish = ConfigManager.getInstance().get<number>('Fire', 'baseExtinguishChance');
    this.handleFireLogic(dt, fireDPS, baseExtinguish);

    if (!this.active) return;

    // 1. MOUSE AIMING
    const screenX = window.innerWidth / 2;
    const screenY = window.innerHeight / 2;
    
    const dx = this.input.mouseX - screenX;
    const dy = this.input.mouseY - screenY;
    const distToMouse = Math.sqrt(dx*dx + dy*dy);
    
    if (distToMouse > 20) {
        const targetRotation = Math.atan2(dy, dx);
        let diff = targetRotation - this.rotation;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.rotation += diff * 10 * dt; 
    }

    // 2. MOVEMENT
    let driveSpeed = 0;
    if (this.input.isKeyDown('KeyW')) driveSpeed = this.speed;
    else if (this.input.isKeyDown('KeyS')) driveSpeed = -this.speed * 0.6;

    if (driveSpeed === 0) {
        this.vx = 0;
        this.vy = 0;
    } else {
        this.vx = Math.cos(this.rotation) * driveSpeed;
        this.vy = Math.sin(this.rotation) * driveSpeed;
    }

    // 3. PASSIVE SEGMENTS
    this.segments.forEach(seg => {
        seg.vx = 0;
        seg.vy = 0;
    });

    this.resolveSegmentConstraints();

    // 4. UPDATE UPGRADES
    this.upgrades.forEach((upgrade) => {
        upgrade.update(dt, enemies, spawnProjectile); 
    });
  }
  
  private resolveSegmentConstraints(): void {
      // Inverse Kinematics / Relaxed Constraints
      // Head is the leader.
      let leader = this as PhysicsBody;
      
      for (let i = 0; i < this.segments.length; i++) {
          const segment = this.segments[i];
          
          const dx = leader.x - segment.x;
          const dy = leader.y - segment.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          // Constraint: maintain distance 'segmentSpacing'
          if (dist !== 0) {
              // If we are PULLING (forward), dist > spacing
              // If we are PUSHING (reverse), dist < spacing
              // We correct the segment position to be exactly 'spacing' away from leader.
              
              // However, for "Car-like reverse", simply snapping distance isn't enough.
              // We need to push the segment AWAY if it's too close.
              
              const diff = dist - this.segmentSpacing;
              
              // Move segment to satisfy constraint
              // We only move the segment, leader is "heavy" (driven)
              const moveX = (dx / dist) * diff;
              const moveY = (dy / dist) * diff;
              
              segment.x += moveX;
              segment.y += moveY;
              
              // Verify Self-Collision with Head
              // If segment overlaps head, push it out?
              // Actually, preventing pass-through is hard with simple constraints.
              // But let's add a basic circle check against the head
              if (i > 0) { // Don't check first segment against head, they are linked
                   // Check collision with Head
                   // ... logic ...
              }
          }
          
          leader = segment;
      }
  }

  render(ctx: CanvasRenderingContext2D): void {
    // Render Upgrades FIRST (behind segments)
    this.upgrades.forEach(u => u.render(ctx));

    // Draw Segments
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i];
      const size = this.radius; 
      
      ctx.beginPath();
      ctx.arc(s.x, s.y, size, 0, Math.PI * 2);
      
      // Brass Gradient
      const grad = ctx.createRadialGradient(s.x - 5, s.y - 5, 2, s.x, s.y, size);
      grad.addColorStop(0, '#ebd5b3'); 
      grad.addColorStop(0.5, '#b58d4a'); 
      grad.addColorStop(1, '#594326'); 
      
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = '#3d2e1e';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw Head
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    
    const headGrad = ctx.createRadialGradient(this.x - 5, this.y - 5, 2, this.x, this.y, this.radius);
    headGrad.addColorStop(0, '#ffdf80');
    headGrad.addColorStop(0.5, '#cfaa6e');
    headGrad.addColorStop(1, '#8c6a36');
    
    ctx.fillStyle = headGrad;
    ctx.fill();
    ctx.strokeStyle = '#594326';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Cannon
    const cannonLen = 25;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x + Math.cos(this.rotation) * cannonLen, this.y + Math.sin(this.rotation) * cannonLen);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 6;
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x + Math.cos(this.rotation) * cannonLen, this.y + Math.sin(this.rotation) * cannonLen);
    ctx.strokeStyle = '#434b4d';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}