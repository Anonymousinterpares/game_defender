import { ConfigManager } from '../../../config/MasterConfig';
import { EntityFactory } from '../EntityFactory';
import { EntityManager } from '../EntityManager';
import { Player } from '../../../entities/Player';
import { Projectile, ProjectileType } from '../../../entities/Projectile';
import { ProjectileComponent } from '../components/ProjectileComponent';
import { Enemy } from '../../../entities/Enemy';
import { CombatSystem } from './CombatSystem';
import { Entity } from '../../Entity';
import { World } from '../../World';
import { HeatMap, MaterialType } from '../../HeatMap';
import { ParticleSystem } from '../../ParticleSystem';
import { MultiplayerManager, NetworkMessageType } from '../../MultiplayerManager';
import { EventBus, GameEvent } from '../../EventBus';

import { System } from '../System';
import { WeaponComponent } from '../components/WeaponComponent';
import { InputComponent } from '../components/InputComponent';
import { PhysicsComponent } from '../components/PhysicsComponent';
import { HealthComponent } from '../components/HealthComponent';
import { FireComponent } from '../components/FireComponent';
import { TagComponent } from '../components/TagComponent';
import { TransformComponent } from '../components/TransformComponent';

export class WeaponSystem implements System {
    public readonly id = 'weapon_system';
    public isFiringBeam: boolean = false;
    public isFiringFlamethrower: boolean = false;
    public beamEndPos: { x: number, y: number } = { x: 0, y: 0 };
    private lastActiveWeapon: string = '';
    private netDamageAccumulator: Map<string, number> = new Map(); // targetId -> damage
    private netIgniteAccumulator: Map<string, boolean> = new Map(); // targetId -> ignite
    private netBroadcastTimer: number = 0;

    constructor(
        private world: World,
        private heatMap: HeatMap,
        private combatSystem: CombatSystem
    ) { }

    public update(dt: number, entityManager: EntityManager, inputManager?: any): void {
        const weaponEntities = entityManager.query(['weapon', 'transform']);

        for (const entityId of weaponEntities) {
            const weaponComp = entityManager.getComponent<WeaponComponent>(entityId, 'weapon')!;
            const transform = entityManager.getComponent<TransformComponent>(entityId, 'transform')!;

            // 1. Update all reload timers
            weaponComp.reloadTimers.forEach((timer, w) => {
                if (weaponComp.reloading.get(w)) {
                    const newTimer = timer - dt;
                    weaponComp.reloadTimers.set(w, newTimer);
                    if (newTimer <= 0) {
                        this.finishReload(weaponComp, w);
                    }
                }
            });

            // 2. Handle firing if it's the local player (has InputComponent)
            const input = entityManager.getComponent<InputComponent>(entityId, 'input');
            if (input && inputManager) {
                const activeWeapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon');
                weaponComp.activeWeapon = activeWeapon;

                this.isFiringBeam = false;
                this.isFiringFlamethrower = false;

                const isReloading = weaponComp.reloading.get(activeWeapon);
                const currentAmmo = weaponComp.ammo.get(activeWeapon) || 0;

                if (inputManager.isActionDown('fire') && !isReloading) {
                    if (['cannon', 'rocket', 'missile', 'mine'].includes(activeWeapon)) {
                        const now = performance.now() / 1000;
                        const shootCooldown = ConfigManager.getInstance().get<number>('Player', 'shootCooldown');
                        if (now - weaponComp.lastShotTime > shootCooldown) {
                            if (currentAmmo >= 1) {
                                this.spawnProjectile(entityManager, entityId, transform, weaponComp, activeWeapon, currentAmmo);
                                weaponComp.lastShotTime = now;
                            } else {
                                this.startReload(entityId, transform, weaponComp, activeWeapon);
                            }
                        }
                    } else if (['laser', 'ray', 'flamethrower'].includes(activeWeapon)) {
                        if (currentAmmo > 0) {
                            if (activeWeapon === 'flamethrower') {
                                this.isFiringFlamethrower = true;
                                this.handleFlamethrowerFiring(entityManager, entityId, transform, dt);
                            } else {
                                this.isFiringBeam = true;
                                this.handleBeamFiring(entityManager, entityId, transform, activeWeapon, dt);
                            }

                            // BROADCAST visual state
                            const mm = MultiplayerManager.getInstance();
                            if (Math.random() < 0.3 && mm.myId !== 'pending') {
                                mm.broadcast(NetworkMessageType.PROJECTILE, {
                                    type: activeWeapon,
                                    x: transform.x,
                                    y: transform.y,
                                    a: transform.rotation,
                                    sid: mm.myId
                                });
                            }

                            const loopSfx = activeWeapon === 'laser' ? 'shoot_laser' : (activeWeapon === 'ray' ? 'shoot_ray' : 'shoot_flamethrower');
                            EventBus.getInstance().emit(GameEvent.SOUND_LOOP_START, { soundId: loopSfx, x: transform.x, y: transform.y });
                            EventBus.getInstance().emit(GameEvent.SOUND_LOOP_MOVE, { soundId: loopSfx, x: transform.x, y: transform.y });

                            const depletion = ConfigManager.getInstance().get<number>('Weapons', activeWeapon + 'DepletionRate');
                            const newAmmo = Math.max(0, currentAmmo - depletion * dt);
                            weaponComp.ammo.set(activeWeapon, newAmmo);

                            if (newAmmo <= 0) {
                                this.startReload(entityId, transform, weaponComp, activeWeapon);
                            }
                        } else {
                            this.startReload(entityId, transform, weaponComp, activeWeapon);
                        }
                    }
                }
            }
        }

        // --- Cleanup and Network ---
        if (!this.isFiringBeam) {
            const eb = EventBus.getInstance();
            ['shoot_laser', 'shoot_ray', 'hit_laser', 'hit_ray'].forEach(id => eb.emit(GameEvent.SOUND_LOOP_STOP, { soundId: id }));
        }

        if (!this.isFiringFlamethrower) {
            EventBus.getInstance().emit(GameEvent.SOUND_LOOP_STOP, { soundId: 'shoot_flamethrower' });
        }

        this.netBroadcastTimer += dt;
        if (this.netBroadcastTimer >= 0.1) {
            const allTargets = new Set([...this.netDamageAccumulator.keys(), ...this.netIgniteAccumulator.keys()]);
            const mm = MultiplayerManager.getInstance();
            const myId = mm.myId;

            allTargets.forEach(targetId => {
                const dmg = this.netDamageAccumulator.get(targetId) || 0;
                const ignite = this.netIgniteAccumulator.get(targetId) || false;

                if (dmg > 0.01 || ignite) {
                    mm.broadcast(NetworkMessageType.PLAYER_HIT, {
                        id: targetId,
                        damage: dmg,
                        killerId: myId,
                        ignite: ignite
                    });
                }
            });

            this.netDamageAccumulator.clear();
            this.netIgniteAccumulator.clear();
            this.netBroadcastTimer = 0;
        }
    }

    private spawnProjectile(entityManager: EntityManager, entityId: string, transform: TransformComponent, weaponComp: WeaponComponent, weapon: string, currentAmmo: number): void {
        const weaponToType: Record<string, ProjectileType> = {
            'cannon': ProjectileType.CANNON,
            'rocket': ProjectileType.ROCKET,
            'missile': ProjectileType.MISSILE,
            'mine': ProjectileType.MINE
        };

        const mm = MultiplayerManager.getInstance();
        const myId = mm.myId;
        const pType = weaponToType[weapon] || ProjectileType.CANNON;

        const pId = EntityFactory.createProjectile(
            entityManager,
            transform.x + Math.cos(transform.rotation) * 25,
            transform.y + Math.sin(transform.rotation) * 25,
            transform.rotation,
            pType,
            entityId // <--- ROBUST FIX: Use actual entity ID as the source of truth
        );

        // BROADCAST to network
        const mm_new = (window as any).MultiplayerManagerInstance;
        if (mm_new && myId !== 'local') {
            mm_new.broadcast('pj', {
                x: transform.x + Math.cos(transform.rotation) * 25,
                y: transform.y + Math.sin(transform.rotation) * 25,
                a: transform.rotation,
                type: pType,
                sid: myId // Network still needs PeerId to route to the correct RemotePlayer
            });
        }

        // --- MISSILE TARGETING ---
        if (pType === ProjectileType.MISSILE) {
            const target = this.combatSystem.findNearestTarget(transform.x, transform.y, entityId);
            const pComp = entityManager.getComponent<ProjectileComponent>(pId, 'projectile');
            if (pComp) {
                pComp.targetId = target?.id || null;
            }
        }

        weaponComp.ammo.set(weapon, currentAmmo - 1);

        EventBus.getInstance().emit(GameEvent.WEAPON_FIRED, {
            x: transform.x, y: transform.y,
            rotation: transform.rotation,
            weaponType: weapon,
            ownerId: myId
        });

        if (weaponComp.ammo.get(weapon)! <= 0 && weapon !== 'cannon') {
            this.startReload(entityId, transform, weaponComp, weapon);
        }
    }

    private startReload(entityId: string, transform: TransformComponent, weaponComp: WeaponComponent, weapon: string): void {
        if (weaponComp.reloading.get(weapon)) return;

        const reloadTime = ConfigManager.getInstance().get<number>('Weapons', weapon + 'ReloadTime');
        const configKey = ['laser', 'ray', 'flamethrower'].includes(weapon) ? 'MaxEnergy' : 'MaxAmmo';
        const maxAmmo = ConfigManager.getInstance().get<number>('Weapons', weapon + configKey);

        if (reloadTime <= 0) {
            weaponComp.ammo.set(weapon, maxAmmo);
            return;
        }

        weaponComp.reloading.set(weapon, true);
        weaponComp.reloadTimers.set(weapon, reloadTime);

        const mm = MultiplayerManager.getInstance();
        EventBus.getInstance().emit(GameEvent.WEAPON_RELOAD, {
            x: transform.x,
            y: transform.y,
            ownerId: mm.myId
        });
    }

    private handleBeamFiring(entityManager: EntityManager, entityId: string, transform: TransformComponent, type: string, dt: number): void {
        const maxDist = type === 'laser' ? 800 : 500;
        const wallHit = this.world.raycast(transform.x, transform.y, transform.rotation, maxDist);

        let dist = 0;
        let hitEntity: any | null = null;
        let hitSomething = !!wallHit;
        let finalX = wallHit ? wallHit.x : transform.x + Math.cos(transform.rotation) * maxDist;
        let finalY = wallHit ? wallHit.y : transform.y + Math.sin(transform.rotation) * maxDist;

        const actualMaxDist = wallHit ? Math.sqrt((wallHit.x - transform.x) ** 2 + (wallHit.y - transform.y) ** 2) : maxDist;

        // Query enemies and potential remote players for hitboxes
        const targetIds = entityManager.query(['transform', 'physics']).filter(id => {
            const tag = entityManager.getComponent<TagComponent>(id, 'tag')?.tag;
            return tag === 'enemy' || tag === 'remote_player' || tag === 'remote_segment';
        });

        const step = 8;
        for (let d = 0; d < actualMaxDist; d += step) {
            const tx = transform.x + Math.cos(transform.rotation) * d;
            const ty = transform.y + Math.sin(transform.rotation) * d;

            for (const id of targetIds) {
                const eTransform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
                const ePhysics = entityManager.getComponent<PhysicsComponent>(id, 'physics')!;

                // Barrier Fix: Only hit active entities
                const h = entityManager.getComponent<HealthComponent>(id, 'health');
                if (h && !h.active) continue;

                // Self-hit protection: shooter's own pieces should not block beams
                const rootId = (window as any).SimulationInstance?.combatSystem.findRootId(id) || id;
                if (rootId === (window as any).SimulationInstance?.player?.id) continue;

                const dx = eTransform.x - tx, dy = eTransform.y - ty;
                if (dx * dx + dy * dy < ePhysics.radius * ePhysics.radius) {
                    hitEntity = {
                        id,
                        takeDamage: (dmg: number) => {
                            const health = entityManager.getComponent<HealthComponent>(id, 'health');
                            if (health) {
                                health.health -= dmg;
                                health.damageFlash = 0.2;
                                if (health.health <= 0) { health.health = 0; health.active = false; }
                            }
                        }
                    };
                    dist = d;
                    finalX = tx; finalY = ty;
                    break;
                }
            }
            if (hitEntity) break;
        }

        if (!hitEntity && wallHit) {
            dist = actualMaxDist;
        } else if (!hitEntity) {
            dist = maxDist;
        }

        this.beamEndPos = { x: finalX, y: finalY };

        if (hitEntity) {
            const dmg = type === 'laser' ? ConfigManager.getInstance().get<number>('Weapons', 'laserDPS') * dt :
                (ConfigManager.getInstance().get<number>('Weapons', 'rayBaseDamage') / (1 + (dist / 32) ** 2)) * dt;

            // RESOLVE ROOT ID: Ensure damage is applied to the head if we hit a segment
            const rootId = (window as any).SimulationInstance?.combatSystem.findRootId(hitEntity.id) || hitEntity.id;
            const isNpc = rootId.startsWith('e_');
            const mm = MultiplayerManager.getInstance();
            const myId = mm.myId;

            if (myId && myId !== 'pending' && !mm.isHost) {
                const current = this.netDamageAccumulator.get(rootId) || 0;
                this.netDamageAccumulator.set(rootId, current + dmg);
            } else {
                if (isNpc) {
                    const h = entityManager.getComponent<HealthComponent>(rootId, 'health');
                    if (h) {
                        h.health -= dmg;
                        h.damageFlash = 0.2;
                        if (h.health <= 0) { h.health = 0; h.active = false; }
                    }
                } else if (rootId !== myId) {
                    const current = this.netDamageAccumulator.get(rootId) || 0;
                    this.netDamageAccumulator.set(rootId, current + dmg);
                }
            }
        }

        const hitSfx = type === 'laser' ? 'hit_laser' : 'hit_ray';

        if (hitSomething || hitEntity) {
            const eb = EventBus.getInstance();
            eb.emit(GameEvent.SOUND_LOOP_START, { soundId: hitSfx, x: this.beamEndPos.x, y: this.beamEndPos.y });
            eb.emit(GameEvent.SOUND_LOOP_MOVE, { soundId: hitSfx, x: this.beamEndPos.x, y: this.beamEndPos.y });

            if (!hitEntity) {
                const heatAmount = type === 'laser' ? 0.4 : 0.6;
                this.heatMap.addHeat(this.beamEndPos.x, this.beamEndPos.y, heatAmount * dt * 5, 12);

                if (this.heatMap.getIntensityAt(this.beamEndPos.x, this.beamEndPos.y) > 0.8 && Math.random() < 0.3) {
                    EventBus.getInstance().emit(GameEvent.PROJECTILE_HIT, {
                        x: this.beamEndPos.x, y: this.beamEndPos.y,
                        projectileType: type,
                        hitType: 'wall'
                    });
                }
            }
        } else {
            EventBus.getInstance().emit(GameEvent.SOUND_LOOP_STOP, { soundId: hitSfx });
        }
    }

    private handleFlamethrowerFiring(entityManager: EntityManager, entityId: string, transform: TransformComponent, dt: number): void {
        const rangeTiles = ConfigManager.getInstance().get<number>('Weapons', 'flamethrowerRange');
        const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');
        const range = rangeTiles * tileSize;
        const damage = ConfigManager.getInstance().get<number>('Weapons', 'flamethrowerDamage');
        const coneAngle = Math.PI / 4;

        const targetIds = entityManager.query(['transform', 'physics']).filter(id => {
            const tag = entityManager.getComponent<TagComponent>(id, 'tag')?.tag;
            return tag === 'enemy' || tag === 'remote_player' || tag === 'remote_segment';
        });

        const mm = MultiplayerManager.getInstance();
        const myId = mm.myId;

        targetIds.forEach(id => {
            const eTransform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
            const ePhysics = entityManager.getComponent<PhysicsComponent>(id, 'physics')!;

            const dx = eTransform.x - transform.x;
            const dy = eTransform.y - transform.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < range) {
                const angleToTarget = Math.atan2(dy, dx);
                let diff = angleToTarget - transform.rotation;
                while (diff < -Math.PI) diff += Math.PI * 2;
                while (diff > Math.PI) diff -= Math.PI * 2;

                if (Math.abs(diff) < coneAngle / 2) {
                    // Barrier Fix: Only hit active entities
                    const h = entityManager.getComponent<HealthComponent>(id, 'health');
                    if (h && !h.active) return;

                    const rootId = (window as any).SimulationInstance?.combatSystem.findRootId(id) || id;
                    if (rootId === (window as any).SimulationInstance?.player?.id) return;

                    const isNpc = rootId.startsWith('e_');

                    if (myId && myId !== 'pending' && !mm.isHost) {
                        const current = this.netDamageAccumulator.get(rootId) || 0;
                        this.netDamageAccumulator.set(rootId, current + damage * dt);
                        if (Math.random() < 0.5 * dt) this.netIgniteAccumulator.set(rootId, true);
                    } else {
                        if (isNpc) {
                            const h = entityManager.getComponent<HealthComponent>(rootId, 'health');
                            if (h) {
                                h.health -= damage * dt;
                                if (Math.random() < 0.5 * dt) {
                                    const f = entityManager.getComponent<FireComponent>(rootId, 'fire');
                                    if (f) f.isOnFire = true;
                                }
                            }
                        } else if (rootId !== myId) {
                            const current = this.netDamageAccumulator.get(rootId) || 0;
                            this.netDamageAccumulator.set(rootId, current + damage * dt);
                            if (Math.random() < 0.5 * dt) this.netIgniteAccumulator.set(rootId, true);
                        }
                    }
                }
            }
        });

        let finalRange = range;
        const steps = 10;
        for (let i = 1; i <= steps; i++) {
            const dist = (i / steps) * range;
            const tx = transform.x + Math.cos(transform.rotation) * dist;
            const ty = transform.y + Math.sin(transform.rotation) * dist;

            if (this.world.isWall(tx, ty)) {
                finalRange = dist;
                const mat = this.heatMap.getMaterialAt(tx, ty);
                for (let j = 0; j < 3; j++) {
                    const jx = tx + (Math.random() - 0.5) * 10;
                    const jy = ty + (Math.random() - 0.5) * 10;
                    if (mat === MaterialType.WOOD) {
                        this.heatMap.forceIgniteArea(jx, jy, 12);
                    }
                    this.heatMap.addHeat(jx, jy, 1.2 * dt * 10, 15);
                }
                break;
            }
        }

        const physics = entityManager.getComponent<PhysicsComponent>(entityId, 'physics');
        const vx = physics ? physics.vx : 0;
        const vy = physics ? physics.vy : 0;

        const flameCount = 3;
        for (let i = 0; i < flameCount; i++) {
            const angleOffset = (Math.random() - 0.5) * coneAngle;
            const pAngle = transform.rotation + angleOffset;
            const speed = (finalRange / 0.5) * (0.8 + Math.random() * 0.4);
            const pvx = Math.cos(pAngle) * speed + vx * 0.5;
            const pvy = Math.sin(pAngle) * speed + vy * 0.5;

            const idx = ParticleSystem.getInstance().spawnParticle(
                transform.x + Math.cos(transform.rotation) * 15,
                transform.y + Math.sin(transform.rotation) * 15,
                Math.random() < 0.3 ? '#ffcc00' : '#ff4400',
                pvx, pvy,
                0.4 + Math.random() * 0.2
            );
            ParticleSystem.getInstance().setFlame(idx, true);
        }
    }

    private finishReload(weaponComp: WeaponComponent, weapon: string): void {
        weaponComp.reloading.set(weapon, false);
        weaponComp.reloadTimers.set(weapon, 0);

        const configKey = ['laser', 'ray', 'flamethrower'].includes(weapon) ? 'MaxEnergy' : 'MaxAmmo';
        const max = ConfigManager.getInstance().get<number>('Weapons', weapon + configKey) || 0;
        weaponComp.ammo.set(weapon, max);
    }
}
