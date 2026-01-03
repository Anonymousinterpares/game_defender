import { ConfigManager } from '../config/MasterConfig';
import { Player } from '../entities/Player';
import { Projectile, ProjectileType } from '../entities/Projectile';
import { Enemy } from '../entities/Enemy';
import { Entity } from '../core/Entity';
import { SoundManager } from '../core/SoundManager';
import { World } from '../core/World';
import { HeatMap, MaterialType } from '../core/HeatMap';
import { Particle } from '../entities/Particle';

export interface WeaponParent {
    player: Player | null;
    world: World | null;
    heatMap: HeatMap | null;
    enemies: Enemy[];
    projectiles: Projectile[];
    particles: any[];
    weaponAmmo: Map<string, number>;
    unlockedWeapons: Set<string>;
    weaponReloading: Map<string, boolean>;
    weaponReloadTimer: Map<string, number>;
    shootCooldown: number;
    lastShotTime: number;
    setLastShotTime(time: number): void;
    startReload(weapon: string): void;
    createImpactParticles(x: number, y: number, color: string): void;
}

export class WeaponSystem {
    public isFiringBeam: boolean = false;
    public isFiringFlamethrower: boolean = false;
    public beamEndPos: { x: number, y: number } = { x: 0, y: 0 };
    private lastActiveWeapon: string = '';

    constructor(private parent: WeaponParent) {}

    public update(dt: number, inputManager: any): void {
        const weapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon');
        
        // Update all reload timers (moved from Scene)
        this.parent.weaponReloadTimer.forEach((timer, w) => {
            if (this.parent.weaponReloading.get(w)) {
                const newTimer = timer - dt;
                this.parent.weaponReloadTimer.set(w, newTimer);
                if (newTimer <= 0) {
                    this.finishReload(w);
                }
            }
        });

        this.isFiringBeam = false;
        this.isFiringFlamethrower = false;
        const isReloading = this.parent.weaponReloading.get(weapon);
        const currentAmmo = this.parent.weaponAmmo.get(weapon) || 0;

        if (inputManager.isKeyDown('Space') && this.parent.player && this.parent.player.active && !isReloading) {
            if (weapon === 'cannon' || weapon === 'rocket' || weapon === 'missile' || weapon === 'mine') {
                const now = performance.now() / 1000;
                if (now - this.parent.lastShotTime > this.parent.shootCooldown) {
                    if (currentAmmo > 0) {
                        this.spawnProjectile(weapon, currentAmmo);
                        this.parent.setLastShotTime(now);
                    } else {
                        this.parent.startReload(weapon);
                    }
                }
            } else if (weapon === 'laser' || weapon === 'ray' || weapon === 'flamethrower') {
                if (currentAmmo > 0) {
                    if (weapon === 'flamethrower') {
                        this.isFiringFlamethrower = true;
                        this.handleFlamethrowerFiring(dt);
                    } else {
                        this.isFiringBeam = true;
                        this.handleBeamFiring(weapon, dt);
                    }
                    const loopSfx = weapon === 'laser' ? 'shoot_laser' : (weapon === 'ray' ? 'shoot_ray' : 'shoot_flamethrower');
                    SoundManager.getInstance().startLoopSpatial(loopSfx, this.parent.player.x, this.parent.player.y);
                    SoundManager.getInstance().updateLoopPosition(loopSfx, this.parent.player.x, this.parent.player.y);
                    
                    const depletion = ConfigManager.getInstance().get<number>('Weapons', weapon + 'DepletionRate');
                    const newAmmo = Math.max(0, currentAmmo - depletion * dt);
                    this.parent.weaponAmmo.set(weapon, newAmmo);
                    
                    if (newAmmo <= 0) {
                        this.parent.startReload(weapon);
                    }
                } else {
                    this.parent.startReload(weapon);
                }
            }
        }

        if (!this.isFiringBeam) {
            SoundManager.getInstance().stopLoopSpatial('shoot_laser');
            SoundManager.getInstance().stopLoopSpatial('shoot_ray');
            SoundManager.getInstance().stopLoopSpatial('hit_laser');
            SoundManager.getInstance().stopLoopSpatial('hit_ray');
        }
        
        if (!this.isFiringFlamethrower) {
            SoundManager.getInstance().stopLoopSpatial('shoot_flamethrower');
        }
    }

    private spawnProjectile(weapon: string, currentAmmo: number): void {
        const player = this.parent.player!;
        const weaponToType: Record<string, ProjectileType> = {
            'cannon': ProjectileType.CANNON,
            'rocket': ProjectileType.ROCKET,
            'missile': ProjectileType.MISSILE,
            'mine': ProjectileType.MINE
        };
        
        const pType = weaponToType[weapon] || ProjectileType.CANNON;
        const p = new Projectile(
            player.x + Math.cos(player.rotation) * 25,
            player.y + Math.sin(player.rotation) * 25,
            player.rotation,
            pType
        );

        if (pType === ProjectileType.MISSILE) {
            let nearest = null;
            let minDist = 1000;
            this.parent.enemies.forEach(e => {
                const d = Math.sqrt((e.x - p.x)**2 + (e.y - p.y)**2);
                if (d < minDist) {
                    minDist = d;
                    nearest = e;
                }
            });
            p.target = nearest;
        }

        this.parent.projectiles.push(p);
        this.parent.weaponAmmo.set(weapon, currentAmmo - 1);
        
        const sfx = 'shoot_' + weapon;
        SoundManager.getInstance().playSoundSpatial(sfx, player.x, player.y);

        if (this.parent.weaponAmmo.get(weapon)! <= 0 && weapon !== 'cannon') {
            this.parent.startReload(weapon);
        }
    }

    private handleBeamFiring(type: string, dt: number): void {
        if (!this.parent.player || !this.parent.world || !this.parent.heatMap) return;
        
        const player = this.parent.player;
        const maxDist = type === 'laser' ? 800 : 500;
        const step = 8;
        let dist = 0;
        let hitEnemy: Enemy | null = null;
        let hitSomething = false;

        const mapW = this.parent.world.getWidthPixels();
        const mapH = this.parent.world.getHeightPixels();
        
        while (dist < maxDist) {
            const tx = player.x + Math.cos(player.rotation) * dist;
            const ty = player.y + Math.sin(player.rotation) * dist;
            
            if (this.parent.world.isWall(tx, ty) || tx < 0 || tx > mapW || ty < 0 || ty > mapH) {
                hitSomething = true;
                break;
            }
            
            for (const e of this.parent.enemies) {
                const dx = e.x - tx;
                const dy = e.y - ty;
                if (Math.sqrt(dx*dx + dy*dy) < e.radius) {
                    hitEnemy = e;
                    hitSomething = true;
                    break;
                }
            }
            if (hitEnemy) break;
            dist += step;
        }
        
        this.beamEndPos = {
            x: player.x + Math.cos(player.rotation) * dist,
            y: player.y + Math.sin(player.rotation) * dist
        };
        
        const hitSfx = type === 'laser' ? 'hit_laser' : 'hit_ray';

        if (hitSomething) {
            SoundManager.getInstance().startLoopSpatial(hitSfx, this.beamEndPos.x, this.beamEndPos.y);
            SoundManager.getInstance().updateLoopPosition(hitSfx, this.beamEndPos.x, this.beamEndPos.y);
            
            if (!hitEnemy) {
                const heatAmount = type === 'laser' ? 0.4 : 0.6;
                this.parent.heatMap.addHeat(this.beamEndPos.x, this.beamEndPos.y, heatAmount * dt * 5, 12);
                
                if (this.parent.heatMap.getIntensityAt(this.beamEndPos.x, this.beamEndPos.y) > 0.8 && Math.random() < 0.3) {
                    this.parent.createImpactParticles(this.beamEndPos.x, this.beamEndPos.y, '#fff');
                }
            }

            if (hitEnemy) {
                if (type === 'laser') {
                    hitEnemy.takeDamage(ConfigManager.getInstance().get<number>('Weapons', 'laserDPS') * dt);
                } else {
                    const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');
                    const distInTiles = dist / tileSize;
                    const base = ConfigManager.getInstance().get<number>('Weapons', 'rayBaseDamage');
                    const damage = (base / (1 + distInTiles * distInTiles)) * dt;
                    hitEnemy.takeDamage(damage);
                }
            }
        } else {
            SoundManager.getInstance().stopLoop(hitSfx, 0.5);
        }
    }

    private handleFlamethrowerFiring(dt: number): void {
        if (!this.parent.player || !this.parent.world || !this.parent.heatMap) return;

        const player = this.parent.player;
        const rangeTiles = ConfigManager.getInstance().get<number>('Weapons', 'flamethrowerRange');
        const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');
        const range = rangeTiles * tileSize;
        const damage = ConfigManager.getInstance().get<number>('Weapons', 'flamethrowerDamage');
        const coneAngle = Math.PI / 4;

        const targets: Entity[] = [...this.parent.enemies];
        targets.forEach(e => {
            const dx = e.x - player.x;
            const dy = e.y - player.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist < range) {
                const angleToTarget = Math.atan2(dy, dx);
                let diff = angleToTarget - player.rotation;
                while (diff < -Math.PI) diff += Math.PI * 2;
                while (diff > Math.PI) diff -= Math.PI * 2;

                if (Math.abs(diff) < coneAngle / 2) {
                    e.takeDamage(damage * dt);
                    (e as any).isOnFire = true;
                }
            }
        });

        const steps = 10;
        let finalRange = range;

        for (let i = 1; i <= steps; i++) {
            const dist = (i / steps) * range;
            const tx = player.x + Math.cos(player.rotation) * dist;
            const ty = player.y + Math.sin(player.rotation) * dist;
            
            if (this.parent.world.isWall(tx, ty)) {
                finalRange = dist;
                const mat = this.parent.heatMap.getMaterialAt(tx, ty);
                for (let j = 0; j < 3; j++) {
                    const jx = tx + (Math.random() - 0.5) * 10;
                    const jy = ty + (Math.random() - 0.5) * 10;
                    if (mat === MaterialType.WOOD) {
                        this.parent.heatMap.forceIgniteArea(jx, jy, 12);
                    }
                    this.parent.heatMap.addHeat(jx, jy, 1.2 * dt * 10, 15);
                }
                break;
            }
        }

        (this as any).flameHitDist = finalRange;

        const flameCount = 3;
        for (let i = 0; i < flameCount; i++) {
            const angleOffset = (Math.random() - 0.5) * coneAngle;
            const pAngle = player.rotation + angleOffset;
            const speed = (finalRange / 0.5) * (0.8 + Math.random() * 0.4); 
            const vx = Math.cos(pAngle) * speed + player.vx * 0.5;
            const vy = Math.sin(pAngle) * speed + player.vy * 0.5;
            
            const p = new Particle(
                player.x + Math.cos(player.rotation) * 15,
                player.y + Math.sin(player.rotation) * 15,
                Math.random() < 0.3 ? '#ffcc00' : '#ff4400',
                vx, vy,
                0.4 + Math.random() * 0.2
            );
            p.isFlame = true;
            this.parent.particles.push(p);
        }
    }

    private finishReload(weapon: string): void {
        this.parent.weaponReloading.set(weapon, false);
        this.parent.weaponReloadTimer.set(weapon, 0);
        
        const configKey = weapon === 'laser' || weapon === 'ray' || weapon === 'flamethrower' ? 'MaxEnergy' : 'MaxAmmo';
        const max = ConfigManager.getInstance().get<number>('Weapons', weapon + configKey);
        this.parent.weaponAmmo.set(weapon, max);
    }
}
