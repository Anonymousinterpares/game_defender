import { Entity } from '../core/Entity';
import { ConfigManager } from '../config/MasterConfig';
import { MaterialType } from '../core/HeatMap';
import { EventBus, GameEvent } from '../core/EventBus';

export enum ProjectileType {
    CANNON = 'cannon',
    ROCKET = 'rocket',
    MISSILE = 'missile',
    MINE = 'mine'
}

export class Projectile extends Entity {
  protected lifeTime: number = 2.0; 
  protected speed: number = 800;
  public type: ProjectileType;
  public damage: number = 10;
  public isArmed: boolean = true;
  public aoeRadius: number = 0;
  public shooterId: string | null = null;
  
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
                  EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'wood' });
              } else if (mat === MaterialType.BRICK) {
                  // 2 layers
                  heatMap.destroyArea(hitX, hitY, subSize * 2);
                  EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'brick' });
              } else if (mat === MaterialType.STONE) {
                  // 1 layer
                  heatMap.destroyArea(hitX, hitY, subSize * 1);
                  EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'stone' });
              } else if (mat === MaterialType.METAL) {
                  // 1 layer AFTER 2nd hit
                  const key = `${Math.floor(hitX/4)},${Math.floor(hitY/4)}`; // sub-tile key roughly
                  const hits = (Projectile.metalHitTracker.get(key) || 0) + 1;
                  if (hits >= 2) {
                      heatMap.destroyArea(hitX, hitY, subSize * 1);
                      Projectile.metalHitTracker.delete(key);
                      EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'metal' });
                  } else {
                      Projectile.metalHitTracker.set(key, hits);
                      // Maybe a small "clink" for non-breaking hit? 
                      // For now just metal hit
                      EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'metal' });
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
                  EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'wood' });
              } else if (mat === MaterialType.BRICK) {
                  // 10 layers
                  heatMap.destroyArea(hitX, hitY, subSize * 10);
                  EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'brick' });
              } else if (mat === MaterialType.STONE) {
                  // 5 layers
                  heatMap.destroyArea(hitX, hitY, subSize * 5);
                  EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'stone' });
              } else if (mat === MaterialType.METAL) {
                  // 3 layers
                  heatMap.destroyArea(hitX, hitY, subSize * 3);
                  EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { x: hitX, y: hitY, material: 'metal' });
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
              this.aoeRadius = (cfg.get<number>('Weapons', 'missileAOE') || 1.5) * cfg.get<number>('World', 'tileSize');
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
    this.prevX = this.x;
    this.prevY = this.y;

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
    const ix = this.interpolatedX;
    const iy = this.interpolatedY;

    ctx.save();
    ctx.translate(ix, iy);
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
    } else if (this.type === ProjectileType.ROCKET || this.type === ProjectileType.MISSILE) {
        // New Pixel-Art Rocket Rendering
        // The SVG is 64x128. We rotate 90deg so it points along X axis.
        // Rocket length: we'll scale it so body is approx radius*4
        ctx.rotate(Math.PI / 2); // Pointing Right (0 deg) -> Up is original SVG orientation
        
        const scale = (this.radius * 4) / 128;
        ctx.scale(scale, scale);
        ctx.translate(-32, -64); // Center of mass roughly

        const drawPixel = (px: number, py: number, w: number, h: number, fill: string) => {
            ctx.fillStyle = fill;
            ctx.fillRect(px, py, w, h);
        };

        // Nose Cone
        drawPixel(30, 4, 4, 4, "#cc2200");
        drawPixel(26, 8, 12, 4, "#cc2200");
        drawPixel(26, 8, 4, 4, "#ff4433");
        drawPixel(22, 12, 20, 4, "#cc2200");
        drawPixel(22, 12, 4, 4, "#ff4433");
        drawPixel(18, 16, 28, 4, "#cc2200");
        drawPixel(18, 16, 8, 4, "#ff4433");
        drawPixel(14, 20, 36, 4, "#cc2200");
        drawPixel(14, 20, 8, 4, "#ff4433");

        // Body
        drawPixel(14, 24, 36, 12, "#e8e8e8"); // Combined upper
        drawPixel(14, 24, 8, 12, "#ffffff"); // Highlights
        
        // Window
        drawPixel(14, 36, 36, 12, "#e8e8e8");
        drawPixel(14, 36, 8, 12, "#ffffff");
        drawPixel(26, 36, 12, 12, "#3399cc"); // Glass
        drawPixel(26, 36, 4, 12, "#66ccff"); // Reflection

        // Red Band
        drawPixel(14, 48, 36, 8, "#cc2200");
        drawPixel(14, 48, 8, 8, "#ff4433");

        // Middle Body
        drawPixel(14, 56, 36, 16, "#e8e8e8");
        drawPixel(14, 56, 8, 16, "#ffffff");

        // Lower Red Band
        drawPixel(14, 72, 36, 4, "#cc2200");
        drawPixel(14, 72, 8, 4, "#ff4433");

        // Lower Body
        drawPixel(14, 76, 36, 4, "#d0d0d0");
        drawPixel(14, 76, 8, 4, "#e8e8e8");
        drawPixel(14, 80, 36, 4, "#c0c0c0");
        drawPixel(14, 80, 8, 4, "#d8d8d8");

        // Fins
        drawPixel(6, 84, 8, 4, "#cc2200"); drawPixel(50, 84, 8, 4, "#aa1100");
        drawPixel(2, 88, 12, 12, "#cc2200"); drawPixel(50, 88, 12, 12, "#aa1100");
        drawPixel(2, 88, 4, 12, "#ff4433");
        // Bottom fins detail
        drawPixel(2, 96, 12, 4, "#aa1100"); drawPixel(50, 96, 12, 4, "#881100");

        // Body bottom part
        drawPixel(14, 84, 36, 4, "#b0b0b0");
        drawPixel(14, 88, 36, 4, "#a0a0a0");
        drawPixel(14, 92, 36, 4, "#909090");
        drawPixel(18, 96, 28, 4, "#808080");

        // Engine
        drawPixel(22, 100, 20, 8, "#505050");

        // Exhaust Flame Animation
        const flicker = Math.random() > 0.5;
        if (flicker) {
            drawPixel(26, 108, 12, 4, "#ffff00");
            drawPixel(28, 112, 8, 4, "#ffff00");
            drawPixel(22, 108, 4, 4, "#ff6600");
            drawPixel(38, 108, 4, 4, "#ff4400");
            drawPixel(28, 120, 8, 4, "#ff4400");
        } else {
            drawPixel(26, 108, 12, 6, "#ffcc00");
            drawPixel(28, 114, 8, 4, "#ff9900");
            drawPixel(22, 108, 4, 4, "#ff4400");
            drawPixel(38, 108, 4, 4, "#ff2200");
            drawPixel(30, 124, 4, 4, "#cc2200");
        }

    } else {
        // Projectile Body (Cannon)
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
    
    // Trail (only for moving projectiles)
    if (this.speed > 0 && this.type === ProjectileType.CANNON) {
        ctx.fillStyle = this.color + '44'; // Alpha
        ctx.beginPath();
        ctx.arc(ix - this.vx * 0.02, iy - this.vy * 0.02, this.radius * 0.7, 0, Math.PI * 2);
        ctx.fill();
    }
  }
}