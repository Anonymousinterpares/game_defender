import { Entity } from '../core/Entity';
import { ConfigManager } from '../config/MasterConfig';
import { MaterialType } from '../core/HeatMap';

export enum ProjectileType {
    CANNON = 'cannon',
    ROCKET = 'rocket',
    MISSILE = 'missile',
    MINE = 'mine'
}

export class Projectile extends Entity {
  public active: boolean = true;
  protected lifeTime: number = 2.0; 
  protected speed: number = 800;
  public type: ProjectileType;
  public damage: number = 10;
  public isArmed: boolean = true;
  public aoeRadius: number = 0;
  
  // For guided missiles
  public target: Entity | null = null;
  private turnSpeed: number = 0;

  // Track hits on metal (1st hit does nothing, 2nd hit damages)
  private static metalHitTracker: Map<string, number> = new Map();

  constructor(x: number, y: number, angle: number, type: ProjectileType = ProjectileType.CANNON) {
    super(x, y);
    this.type = type;
    this.rotation = angle;
    this.setupType();
  }

  public onWorldHit(heatMap: any, hitX: number, hitY: number): void {
      const mat = heatMap.getMaterialAt(hitX, hitY);
      const subSize = heatMap.tileSize / 10; // 1 layer = 1 sub-tile

      switch(this.type) {
          case ProjectileType.CANNON:
              if (mat === MaterialType.WOOD) {
                  // Cannon vs Wood: Star-like irregular shape (0 to 10 sub-tiles deep)
                  heatMap.destroyArea(hitX, hitY, this.radius, true); 
              } else if (mat === MaterialType.BRICK) {
                  // 2 layers
                  heatMap.destroyArea(hitX, hitY, subSize * 2);
              } else if (mat === MaterialType.STONE) {
                  // 1 layer
                  heatMap.destroyArea(hitX, hitY, subSize * 1);
              } else if (mat === MaterialType.METAL) {
                  // 1 layer AFTER 2nd hit
                  const key = `${Math.floor(hitX/4)},${Math.floor(hitY/4)}`; // sub-tile key roughly
                  const hits = (Projectile.metalHitTracker.get(key) || 0) + 1;
                  if (hits >= 2) {
                      heatMap.destroyArea(hitX, hitY, subSize * 1);
                      Projectile.metalHitTracker.delete(key);
                  } else {
                      Projectile.metalHitTracker.set(key, hits);
                  }
              }
              break;

          case ProjectileType.ROCKET:
          case ProjectileType.MISSILE:
          case ProjectileType.MINE:
              const radius = this.aoeRadius > 0 ? this.aoeRadius : 20; // Default for projectiles
              
              if (mat === MaterialType.WOOD) {
                  // Area of 2 length units (20 sub-tiles) + star-like up to 100% depth
                  heatMap.destroyArea(hitX, hitY, subSize * 20, true);
              } else if (mat === MaterialType.BRICK) {
                  // 10 layers
                  heatMap.destroyArea(hitX, hitY, subSize * 10);
              } else if (mat === MaterialType.STONE) {
                  // 5 layers
                  heatMap.destroyArea(hitX, hitY, subSize * 5);
              } else if (mat === MaterialType.METAL) {
                  // 3 layers
                  heatMap.destroyArea(hitX, hitY, subSize * 3);
              }
              break;
      }
  }

  private setupType() {
      const cfg = ConfigManager.getInstance();
      switch(this.type) {
          case ProjectileType.CANNON:
              this.speed = 800;
              this.damage = cfg.get<number>('Weapons', 'cannonDamage');
              this.radius = 4;
              this.color = '#ffff00';
              break;
          case ProjectileType.ROCKET:
              this.speed = 600;
              this.damage = cfg.get<number>('Weapons', 'rocketDamage');
              this.aoeRadius = cfg.get<number>('Weapons', 'rocketAOE') * cfg.get<number>('World', 'tileSize');
              this.radius = 6;
              this.color = '#ff6600';
              this.lifeTime = 3.0;
              break;
          case ProjectileType.MISSILE:
              this.speed = cfg.get<number>('Weapons', 'missileSpeed') * cfg.get<number>('World', 'tileSize');
              this.damage = cfg.get<number>('Weapons', 'missileDamage');
              this.turnSpeed = cfg.get<number>('Weapons', 'missileTurnSpeed');
              this.radius = 5;
              this.color = '#00ffff';
              this.lifeTime = 5.0;
              break;
          case ProjectileType.MINE:
              this.speed = 0;
              this.damage = cfg.get<number>('Weapons', 'mineDamage');
              this.aoeRadius = cfg.get<number>('Weapons', 'mineAOE') * cfg.get<number>('World', 'tileSize');
              this.radius = 8;
              this.color = '#ff0000';
              this.lifeTime = 30.0;
              this.isArmed = false;
              const armTime = cfg.get<number>('Weapons', 'mineArmTime');
              setTimeout(() => { this.isArmed = true; this.color = '#ff3333'; }, armTime * 1000);
              break;
      }
      
      this.vx = Math.cos(this.rotation) * this.speed;
      this.vy = Math.sin(this.rotation) * this.speed;
  }

  update(dt: number): void {
    if (this.type === ProjectileType.MISSILE && this.target && this.target.active) {
        const dx = this.target.x - this.x;
        const dy = this.target.y - this.y;
        const targetAngle = Math.atan2(dy, dx);
        
        // Simple interpolation for "inertia" feel
        let angleDiff = targetAngle - this.rotation;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        
        this.rotation += angleDiff * this.turnSpeed;
        this.vx = Math.cos(this.rotation) * this.speed;
        this.vy = Math.sin(this.rotation) * this.speed;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    
    this.lifeTime -= dt;
    if (this.lifeTime <= 0) {
      this.active = false;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);

    if (this.type === ProjectileType.MINE) {
        // Mine pulses when armed
        const pulse = this.isArmed ? Math.sin(Date.now() * 0.01) * 2 : 0;
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(0, 0, this.radius + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(0, 0, this.radius + pulse, 0, Math.PI * 2);
        ctx.fill();
    } else {
        // Projectile Body
        ctx.fillStyle = this.color;
        if (this.type === ProjectileType.ROCKET || this.type === ProjectileType.MISSILE) {
            ctx.fillRect(-this.radius*2, -this.radius, this.radius*3, this.radius*2);
            // Engine glow
            ctx.fillStyle = '#fff';
            ctx.fillRect(-this.radius*2, -this.radius/2, this.radius/2, this.radius);
        } else {
            ctx.beginPath();
            ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();
    
    // Trail (only for moving projectiles)
    if (this.speed > 0) {
        ctx.fillStyle = this.color + '44'; // Alpha
        ctx.beginPath();
        ctx.arc(this.x - this.vx * 0.02, this.y - this.vy * 0.02, this.radius * 0.7, 0, Math.PI * 2);
        ctx.fill();
    }
  }
}