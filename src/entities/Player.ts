import { Entity, PhysicsBody } from '../core/Entity';
import { ConfigManager } from '../config/MasterConfig';
import { InputManager } from '../core/InputManager';
import { Upgrade } from './upgrades/Upgrade';

export class Player extends Entity {
  public segments: Entity[] = []; // Treat segments as full Entities for collision
  public upgrades: Map<number, Upgrade> = new Map(); // Index -> Upgrade
  public inputManager: InputManager;
  
  // Stats
  private baseSpeedStat: number = 0;
  private speed: number = 0;
  private turnSpeed: number = 0;
  private bodyLength: number = 2;
  private segmentSpacing: number = 35; // Increased: Radius is 15, so 30 is sum. 35 prevents initial overlap.

  constructor(x: number, y: number, input: InputManager) {
    super(x, y);
    this.inputManager = input;
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
          render(ctx: CanvasRenderingContext2D) {} // Removed
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
    
    // Track previous positions for all segments for smooth interpolation
    this.segments.forEach(seg => {
        seg.prevX = seg.x;
        seg.prevY = seg.y;
        seg.handleFireLogic(dt, fireDPS, baseExtinguish);
    });

    if (!this.active || !this.inputManager) return;

    // 1. MOUSE AIMING
    const screenX = window.innerWidth / 2;
    const screenY = window.innerHeight / 2;
    
    const dx = this.inputManager.mouseX - screenX;
    const dy = this.inputManager.mouseY - screenY;
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
    if (this.inputManager.isActionDown('moveUp')) driveSpeed = this.speed;
    else if (this.inputManager.isActionDown('moveDown')) driveSpeed = -this.speed * 0.6;

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
              const diff = dist - this.segmentSpacing;
              
              const moveX = (dx / dist) * diff;
              const moveY = (dy / dist) * diff;
              
              segment.x += moveX;
              segment.y += moveY;
          }
          
          leader = segment;
      }
  }

  // Deprecated render methods removed. Logic now in RenderSystem.
  render(ctx: CanvasRenderingContext2D, alpha?: number): void {}
}