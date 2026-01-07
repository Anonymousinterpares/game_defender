import { SoundManager } from '../core/SoundManager';
import { LightManager } from '../core/LightManager';
import { FloorDecalManager } from '../core/FloorDecalManager';
import { Particle, MoltenMetalParticle, FlashParticle, ShockwaveParticle } from '../entities/Particle';
import { MaterialType, HeatMap } from '../core/HeatMap';
import { Enemy } from '../entities/Enemy';
import { RemotePlayer } from '../entities/RemotePlayer';
import { Player } from '../entities/Player';
import { Projectile, ProjectileType } from '../entities/Projectile';
import { World } from '../core/World';
import { PhysicsEngine } from '../core/PhysicsEngine';
import { ConfigManager } from '../config/MasterConfig';
import { Drop, DropType } from '../entities/Drop';
import { ParticleSystem } from '../core/ParticleSystem';
import { MultiplayerManager, NetworkMessageType } from '../core/MultiplayerManager';

export interface CombatParent {
    enemies: Enemy[];
    remotePlayers: RemotePlayer[];
    player: Player | null;
    heatMap: HeatMap | null;
    projectiles: Projectile[];
    drops: Drop[];
    coinsCollected: number;
    world: World | null;
    physics: PhysicsEngine;
    myId?: string;
    onExplosion?: (x: number, y: number, radius: number, damage: number) => void;
    lastKilledBy?: string | null;
}

export class CombatSystem {
    constructor(private parent: any) {} // Using any temporarily to avoid strict circular dependency issues during refactor

    public update(dt: number): void {
        this.resolveProjectileCollisions();
        this.resolveDropCollection();
    }

    private resolveDropCollection(): void {
        const { player, drops, physics } = this.parent;
        if (!player) return;

        for (const d of drops) {
            if (physics.checkCollision(player, d)) {
                d.active = false;
                SoundManager.getInstance().playSound('collect_coin');
                if (d.type === DropType.COIN) {
                    this.parent.coinsCollected += 10;
                }
                
                if (this.parent.onDropCollected) {
                    this.parent.onDropCollected(d);
                }
            }
        }
    }

    private resolveProjectileCollisions(): void {
        const { world, projectiles, enemies, remotePlayers, physics, player } = this.parent;
        if (!world || !player) return;

        for (const p of projectiles) {
            // Projectile vs World - REMOVED (Handled in Scene for better network sync)

            // Projectile vs Entities (Enemies & RemotePlayers)
            if (p.active) {
                let hit = false;
                
                // Check Enemies
                for (const e of enemies) {
                    if (physics.checkCollision(p, e)) {
                        if (p.type === ProjectileType.MINE && !p.isArmed) continue;
                        
                        if (p.aoeRadius > 0) {
                            this.createExplosion(p.x, p.y, p.aoeRadius, p.damage);
                        } else {
                            e.takeDamage(p.damage);
                            const sfx = p.type === ProjectileType.MISSILE ? 'hit_missile' : 'hit_cannon';
                            SoundManager.getInstance().playSoundSpatial(sfx, p.x, p.y);
                        }
                        p.active = false;
                        hit = true;
                        break;
                    }
                }
                
                if (hit) continue;

                // Check local player
                if (player && player.active) {
                    const bodies = player.getAllBodies();
                    let hitLocal = false;
                    for (const b of bodies) {
                        if (physics.checkCollision(p, b)) {
                            // IGNORE direct hits from self
                            const isSelf = p.shooterId === this.parent.myId;
                            
                            // Safety: If shooterId is null/empty, we assume it's NOT self for hits, 
                            // but we also check if it's very close to muzzle to prevent suicide
                            const distToMuzzle = Math.sqrt((p.x - player.x)**2 + (p.y - player.y)**2);
                            if ((isSelf || !p.shooterId) && distToMuzzle < 32 && p.aoeRadius <= 0) continue; 

                            if (isSelf && p.aoeRadius <= 0) continue; 

                            if (p.type === ProjectileType.MINE && !p.isArmed) continue;

                            console.log(`[CMBT] Hit LOCAL Player! Shooter: ${p.shooterId || 'NULL'} | MyID: ${this.parent.myId}`);

                            if (p.aoeRadius > 0) {
                                this.createExplosion(p.x, p.y, p.aoeRadius, p.damage, p.shooterId);
                            } else {
                                // Direct hit from someone else - BROADCAST (Authoritative)
                                if (p.shooterId && p.shooterId !== this.parent.myId) {
                                    // Visual impact only locally
                                    const sfx = p.type === ProjectileType.MISSILE ? 'hit_missile' : 'hit_cannon';
                                    SoundManager.getInstance().playSoundSpatial(sfx, p.x, p.y);
                                    this.createImpactParticles(p.x, p.y, player.color);
                                    
                                    // We don't call player.takeDamage here anymore!
                                    // The shooter will broadcast the hit, or we could broadcast our own hit.
                                    // For consistency: Shooter broadcasts hits they observe.
                                }
                            }
                            p.active = false;
                            hitLocal = true;
                            break;
                        }
                    }
                    if (hitLocal) continue;
                }

                // Check RemotePlayers
                if (remotePlayers) {
                    for (const rp of remotePlayers) {
                        // IGNORE if this remote player is the shooter
                        if (p.shooterId === rp.id && p.aoeRadius <= 0) continue;

                        const distToHead = Math.sqrt((p.x - rp.x)**2 + (p.y - rp.y)**2);
                        if (distToHead < 64 && Math.random() < 0.1) {
                            console.log(`[CMBT] Proj near RP ${rp.id} | Dist: ${Math.round(distToHead)} | P: ${Math.round(p.x)},${Math.round(p.y)} | RP: ${Math.round(rp.x)},${Math.round(rp.y)}`);
                        }
                        if (distToHead > 300) continue; 

                        const bodies = rp.getAllBodies();
                        for (const b of bodies) {
                            if (physics.checkCollision(p, b)) {
                                if (p.type === ProjectileType.MINE && !p.isArmed) continue;

                                console.log(`[CMBT] Hit REMOTE Player ${rp.id}! Shooter: ${p.shooterId}`);

                                if (p.aoeRadius > 0) {
                                    this.createExplosion(p.x, p.y, p.aoeRadius, p.damage, p.shooterId);
                                } else {
                                    // Visual hit locally
                                    const sfx = p.type === ProjectileType.MISSILE ? 'hit_missile' : 'hit_cannon';
                                    SoundManager.getInstance().playSoundSpatial(sfx, p.x, p.y);
                                    this.createImpactParticles(p.x, p.y, rp.color);

                                    // BROADCAST the hit IF I AM THE SHOOTER
                                    if (p.shooterId === this.parent.myId) {
                                        const mm = MultiplayerManager.getInstance();
                                        mm.broadcast(NetworkMessageType.PLAYER_HIT, { 
                                            id: rp.id, 
                                            damage: p.damage, 
                                            killerId: this.parent.myId 
                                        });
                                    }
                                }
                                p.active = false;
                                hit = true;
                                break;
                            }
                        }
                        if (hit) break;
                    }
                }
            }
        }
    }

    public createExplosion(x: number, y: number, radius: number, damage: number, shooterId: string | null = null): void {
        if (this.parent.onExplosion) {
            this.parent.onExplosion(x, y, radius, damage);
        }

        const mm = MultiplayerManager.getInstance();
        const isMyExplosion = shooterId === this.parent.myId;

        SoundManager.getInstance().playSoundSpatial('explosion_large', x, y);
        // ... (rest of visual code remains same)
        LightManager.getInstance().addTransientLight('explosion', x, y);
        FloorDecalManager.getInstance().addScorchMark(x, y, radius);
        
        // 1. Initial Flash
        ParticleSystem.getInstance().spawnFlash(x, y, radius * 2.5);
        
        // 2. Shockwave
        ParticleSystem.getInstance().spawnShockwave(x, y, radius * 1.8);

        // ... (fireball/smoke logic)
        const fireCount = 12 + Math.floor(Math.random() * 6);
        for (let i = 0; i < fireCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 100 + Math.random() * 300;
            const life = 0.3 + Math.random() * 0.4;
            const idx = ParticleSystem.getInstance().spawnParticle(x, y, '#fffbe6', Math.cos(angle) * speed, Math.sin(angle) * speed, life);
            ParticleSystem.getInstance().setFlame(idx, true);
        }

        const smokeCount = 20 + Math.floor(Math.random() * 10);
        for (let i = 0; i < smokeCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 40 + Math.random() * 80;
            const life = 1.0 + Math.random() * 1.5;
            const color = Math.random() < 0.5 ? '#333' : '#555';
            ParticleSystem.getInstance().spawnParticle(x, y, color, Math.cos(angle) * speed, Math.sin(angle) * speed, life);
        }
        
        if (this.parent.heatMap) {
            this.parent.heatMap.addHeat(x, y, 0.8, radius * 1.5);
            // ... (shrapnel code)
            const centerMat = this.parent.heatMap.getMaterialAt(x, y);
            if (centerMat !== MaterialType.NONE) {
                SoundManager.getInstance().playMaterialHit(MaterialType[centerMat].toLowerCase(), x, y);
            }

            let shrapnelCount = 0;
            const scanRadius = Math.max(radius, 32); 
            const step = 8;
            
            for (let dy = -scanRadius; dy <= scanRadius; dy += step) {
                for (let dx = -scanRadius; dx <= scanRadius; dx += step) {
                    const distSq = dx*dx + dy*dy;
                    if (distSq <= scanRadius*scanRadius) {
                        const worldX = x + dx;
                        const worldY = y + dy;
                        const mat = this.parent.heatMap.getMaterialAt(worldX, worldY);
                        const inst = this.parent.heatMap.getIntensityAt(worldX, worldY);
                        const moltenVal = this.parent.heatMap.getMoltenAt(worldX, worldY);
                        
                        if (moltenVal > 0.1 || (mat === MaterialType.METAL && inst > 0.5)) {
                            shrapnelCount++;
                        }
                    }
                }
            }

            const actualParticles = Math.min(150, shrapnelCount);
            if (actualParticles > 0) {
                for (let i = 0; i < actualParticles; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 64 + Math.random() * 96;
                    const speed = (dist / 0.75); 
                    ParticleSystem.getInstance().spawnMoltenMetal(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed);
                }
            }
        }

        // --- DAMAGE LOGIC (Authoritative) ---
        this.parent.enemies.forEach((e: Enemy) => {
            const dx = e.x - x;
            const dy = e.y - y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < radius) {
                const falloff = 1 - (dist / radius);
                e.takeDamage(damage * falloff);
            }
        });

        if (this.parent.player) {
            const dx = this.parent.player.x - x;
            const dy = this.parent.player.y - y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < radius) {
                const falloff = 1 - (dist / radius);
                // IF I OWN THE EXPLOSION, broadcast hit to myself
                if (isMyExplosion) {
                    mm.broadcast(NetworkMessageType.PLAYER_HIT, { 
                        id: this.parent.myId, 
                        damage: damage * falloff, 
                        killerId: shooterId 
                    });
                }
            }
        }

        if (this.parent.remotePlayers) {
            this.parent.remotePlayers.forEach((rp: RemotePlayer) => {
                const dx = rp.x - x;
                const dy = rp.y - y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist < radius) {
                    const falloff = 1 - (dist / radius);
                    // IF I OWN THE EXPLOSION, broadcast hit to this remote player
                    if (isMyExplosion) {
                        mm.broadcast(NetworkMessageType.PLAYER_HIT, { 
                            id: rp.id, 
                            damage: damage * falloff, 
                            killerId: shooterId 
                        });
                    }
                }
            });
        }
    }

    public createImpactParticles(x: number, y: number, color: string): void {
        LightManager.getInstance().addTransientLight('impact', x, y);
        const count = 5 + Math.floor(Math.random() * 5);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 50 + Math.random() * 150;
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed;
            ParticleSystem.getInstance().spawnParticle(x, y, color, vx, vy, 0.3 + Math.random() * 0.4);
        }
    }
}
