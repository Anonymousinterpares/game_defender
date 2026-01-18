/// <reference types="vite/client" />
import { ConfigManager } from '../config/MasterConfig';
import { EntityManager } from './ecs/EntityManager';
import { TransformComponent } from './ecs/components/TransformComponent';
import { PhysicsComponent } from './ecs/components/PhysicsComponent';
import { HealthComponent } from './ecs/components/HealthComponent';
import { FireComponent } from './ecs/components/FireComponent';

export interface PhysicsBody {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    prevX: number;
    prevY: number;
    prevZ: number;
    radius: number;
    isStatic: boolean;
}

export abstract class Entity implements PhysicsBody {
  public id: string = Math.random().toString(36).substr(2, 9);
  
  protected _entityManager: EntityManager | null = null;

  public setEntityManager(em: EntityManager): void {
      this._entityManager = em;
  }

  // Bind properties to ECS components if they exist
  public get x(): number {
      const t = this._entityManager?.getComponent<TransformComponent>(this.id, 'transform');
      return t ? t.x : this._rawX;
  }
  public set x(val: number) {
      const t = this._entityManager?.getComponent<TransformComponent>(this.id, 'transform');
      if (t) t.x = val; else this._rawX = val;
  }

  public get y(): number {
      const t = this._entityManager?.getComponent<TransformComponent>(this.id, 'transform');
      return t ? t.y : this._rawY;
  }
  public set y(val: number) {
      const t = this._entityManager?.getComponent<TransformComponent>(this.id, 'transform');
      if (t) t.y = val; else this._rawY = val;
  }

  public get z(): number {
      const t = this._entityManager?.getComponent<TransformComponent>(this.id, 'transform');
      return t ? t.z : this._rawZ;
  }
  public set z(val: number) {
      const t = this._entityManager?.getComponent<TransformComponent>(this.id, 'transform');
      if (t) t.z = val; else this._rawZ = val;
  }

  public get vx(): number {
      const p = this._entityManager?.getComponent<PhysicsComponent>(this.id, 'physics');
      return p ? p.vx : this._rawVx;
  }
  public set vx(val: number) {
      const p = this._entityManager?.getComponent<PhysicsComponent>(this.id, 'physics');
      if (p) p.vx = val; else this._rawVx = val;
  }

  public get vy(): number {
      const p = this._entityManager?.getComponent<PhysicsComponent>(this.id, 'physics');
      return p ? p.vy : this._rawVy;
  }
  public set vy(val: number) {
      const p = this._entityManager?.getComponent<PhysicsComponent>(this.id, 'physics');
      if (p) p.vy = val; else this._rawVy = val;
  }

  public get vz(): number {
      const p = this._entityManager?.getComponent<PhysicsComponent>(this.id, 'physics');
      return p ? p.vz : this._rawVz;
  }
  public set vz(val: number) {
      const p = this._entityManager?.getComponent<PhysicsComponent>(this.id, 'physics');
      if (p) p.vz = val; else this._rawVz = val;
  }

  public get prevX(): number {
      const t = this._entityManager?.getComponent<TransformComponent>(this.id, 'transform');
      return t ? t.prevX : this._rawPrevX;
  }
  public set prevX(val: number) {
      const t = this._entityManager?.getComponent<TransformComponent>(this.id, 'transform');
      if (t) t.prevX = val; else this._rawPrevX = val;
  }

  public get prevY(): number {
      const t = this._entityManager?.getComponent<TransformComponent>(this.id, 'transform');
      return t ? t.prevY : this._rawPrevY;
  }
  public set prevY(val: number) {
      const t = this._entityManager?.getComponent<TransformComponent>(this.id, 'transform');
      if (t) t.prevY = val; else this._rawPrevY = val;
  }

  public get prevZ(): number {
      const t = this._entityManager?.getComponent<TransformComponent>(this.id, 'transform');
      return t ? t.prevZ : this._rawPrevZ;
  }
  public set prevZ(val: number) {
      const t = this._entityManager?.getComponent<TransformComponent>(this.id, 'transform');
      if (t) t.prevZ = val; else this._rawPrevZ = val;
  }

  public get rotation(): number {
      const t = this._entityManager?.getComponent<TransformComponent>(this.id, 'transform');
      return t ? t.rotation : this._rawRotation;
  }
  public set rotation(val: number) {
      const t = this._entityManager?.getComponent<TransformComponent>(this.id, 'transform');
      if (t) t.rotation = val; else this._rawRotation = val;
  }

  // Raw values for when ECS isn't active for this entity
  private _rawX: number = 0;
  private _rawY: number = 0;
  private _rawZ: number = 0;
  private _rawVx: number = 0;
  private _rawVy: number = 0;
  private _rawVz: number = 0;
  private _rawPrevX: number = 0;
  private _rawPrevY: number = 0;
  private _rawPrevZ: number = 0;
  private _rawRotation: number = 0;

  public radius: number = 10;
  public isStatic: boolean = false;
  public color: string = '#fff';

  // Health and Fire State Bindings
  public get health(): number {
      return this._entityManager?.getComponent<HealthComponent>(this.id, 'health')?.health ?? this._rawHealth;
  }
  public set health(val: number) {
      const h = this._entityManager?.getComponent<HealthComponent>(this.id, 'health');
      if (h) h.health = val; else this._rawHealth = val;
  }

  public get maxHealth(): number {
      return this._entityManager?.getComponent<HealthComponent>(this.id, 'health')?.maxHealth ?? this._rawMaxHealth;
  }
  public set maxHealth(val: number) {
      const h = this._entityManager?.getComponent<HealthComponent>(this.id, 'health');
      if (h) h.maxHealth = val; else this._rawMaxHealth = val;
  }

  public get active(): boolean {
      return this._entityManager?.getComponent<HealthComponent>(this.id, 'health')?.active ?? this._rawActive;
  }
  public set active(val: boolean) {
      const h = this._entityManager?.getComponent<HealthComponent>(this.id, 'health');
      if (h) h.active = val; else this._rawActive = val;
  }

  public get isOnFire(): boolean {
      return this._entityManager?.getComponent<FireComponent>(this.id, 'fire')?.isOnFire ?? this._rawIsOnFire;
  }
  public set isOnFire(val: boolean) {
      const f = this._entityManager?.getComponent<FireComponent>(this.id, 'fire');
      if (f) f.isOnFire = val; else this._rawIsOnFire = val;
  }

  private _rawHealth: number = 100;
  private _rawMaxHealth: number = 100;
  private _rawActive: boolean = true;
  private _rawIsOnFire: boolean = false;

  public get damageFlash(): number {
      return this._entityManager?.getComponent<HealthComponent>(this.id, 'health')?.damageFlash ?? this._rawDamageFlash;
  }
  public set damageFlash(val: number) {
      const h = this._entityManager?.getComponent<HealthComponent>(this.id, 'health');
      if (h) h.damageFlash = val; else this._rawDamageFlash = val;
  }

  public get visualScale(): number {
      return this._entityManager?.getComponent<HealthComponent>(this.id, 'health')?.visualScale ?? this._rawVisualScale;
  }
  public set visualScale(val: number) {
      const h = this._entityManager?.getComponent<HealthComponent>(this.id, 'health');
      if (h) h.visualScale = val; else this._rawVisualScale = val;
  }

  private _rawDamageFlash: number = 0;
  private _rawVisualScale: number = 1.0;

  constructor(x: number, y: number) {
    this._rawX = x;
    this._rawY = y;
    this._rawPrevX = x;
    this._rawPrevY = y;
  }

  public takeDamage(amount: number): void {
    if (amount <= 0) return;
    
    this.health -= amount;
    
    // Trigger damage feedback if not already flashing intensely
    if (this.damageFlash <= 0.1) {
        this.damageFlash = 0.2; // 200ms
        this.visualScale = 1.2;  // 20% bump
    }

    if (this.health <= 0) {
      this.health = 0;
      this.active = false;
    }
  }

  /**
   * Returns all physical bodies/hitboxes associated with this entity.
   * Defaults to just the entity itself, but can be overridden (e.g., by Player/RemotePlayer).
   */
  public getAllBodies(): PhysicsBody[] {
      return [this];
  }

  /**
   * Generic collision check against all hitboxes of this entity.
   */
  public checkHitbox(x: number, y: number): boolean {
      const bodies = this.getAllBodies();
      for (const b of bodies) {
          const dx = b.x - x;
          const dy = b.y - y;
          if (dx*dx + dy*dy < b.radius * b.radius) return true;
      }
      return false;
  }

  public handleFireLogic(dt: number, fireDPS: number, baseExtinguishChance: number): void {
      // DEPRECATED: Visual timers now handled by FireSystem.
  }

  // Removed renderFire and interpolated getters.
  // We still need abstract render because Simulation calls it for legacy support,
  // but it can be empty for ECS entities.
  abstract update(dt: number, ...args: any[]): void;
  abstract render(ctx: CanvasRenderingContext2D, alpha?: number): void;
  
  // Compatibility: If something still tries to call setInterpolationAlpha on Entity, we should warn or remove it.
  // Since we removed it from usage, we remove it here.
  public static setInterpolationAlpha(alpha: number): void {
      // No-op or removed. Keeping it for a moment if I missed any usage.
      // I'll remove it.
  }
}