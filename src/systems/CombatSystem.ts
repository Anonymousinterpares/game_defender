import { MaterialType, HeatMap } from '../core/HeatMap';
import { Enemy } from '../entities/Enemy';
import { RemotePlayer } from '../entities/RemotePlayer';
import { Player } from '../entities/Player';
import { Projectile, ProjectileType } from '../entities/Projectile';
import { World } from '../core/World';
import { ConfigManager } from '../config/MasterConfig';
import { Drop, DropType } from '../entities/Drop';
import { MultiplayerManager, NetworkMessageType } from '../core/MultiplayerManager';
import { EventBus, GameEvent } from '../core/EventBus';

export interface CombatParent {
    enemies: Enemy[];
    remotePlayers: RemotePlayer[];
    player: Player | null;
    heatMap: HeatMap | null;
    projectiles: Projectile[];
    drops: Drop[];
    coinsCollected: number;
    world: World | null;
    myId?: string;
    onExplosion?: (x: number, y: number, radius: number, damage: number) => void;
    lastKilledBy?: string | null;
}

export class CombatSystem {
    constructor(private parent: any) {} 

    public update(dt: number): void {
        this.resolveProjectileCollisions();
        this.resolveDropCollection();
    }

    private checkCollision(a: {x: number, y: number, radius: number}, b: {x: number, y: number, radius: number}): boolean {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = dx * dx + dy * dy;
        const radSum = a.radius + b.radius;
        return distSq < radSum * radSum;
    }

    private resolveDropCollection(): void {
        const { player, drops } = this.parent;
        if (!player) return;

        for (const d of drops) {
            if (this.checkCollision(player, d)) {
                d.active = false;
                EventBus.getInstance().emit(GameEvent.ITEM_COLLECTED, { x: d.x, y: d.y, itemType: 'coin', collectorId: this.parent.myId || 'local' });
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
        const { world, projectiles, enemies, remotePlayers, player } = this.parent;
        if (!world || !player) return;

        for (const p of projectiles) {
            // Projectile vs Entities (Enemies & RemotePlayers)
            if (p.active) {
                let hit = false;
                
                // Check Enemies
                for (const e of enemies) {
                    if (this.checkCollision(p, e)) {
                        if (p.type === ProjectileType.MINE && !p.isArmed) continue;
                        
                        if (p.aoeRadius > 0) {
                            this.createExplosion(p.x, p.y, p.aoeRadius, p.damage);
                        } else {
                            e.takeDamage(p.damage);
                            EventBus.getInstance().emit(GameEvent.PROJECTILE_HIT, { 
                                x: p.x, y: p.y, 
                                projectileType: p.type, 
                                hitType: 'entity' 
                            });
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
                        if (this.checkCollision(p, b)) {
                            // IGNORE direct hits from self
                            const isSelf = p.shooterId === this.parent.myId;
                            
                            const distToMuzzle = Math.sqrt((p.x - player.x)**2 + (p.y - player.y)**2);
                            if ((isSelf || !p.shooterId) && distToMuzzle < 32 && p.aoeRadius <= 0) continue; 

                            if (isSelf && p.aoeRadius <= 0) continue; 

                            if (p.type === ProjectileType.MINE && !p.isArmed) continue;

                            if (p.aoeRadius > 0) {
                                this.createExplosion(p.x, p.y, p.aoeRadius, p.damage, p.shooterId);
                            } else {
                                EventBus.getInstance().emit(GameEvent.PROJECTILE_HIT, { 
                                    x: p.x, y: p.y, 
                                    projectileType: p.type, 
                                    hitType: 'entity' 
                                });
                                if (player && player.color) {
                                    EventBus.getInstance().emit(GameEvent.ENTITY_HIT, {
                                        x: p.x, y: p.y,
                                        damage: p.damage,
                                        targetId: 'local',
                                        sourceId: p.shooterId || '',
                                        color: player.color
                                    });
                                }
                            }

                            if (this.parent.myId === 'local') {
                                player.takeDamage(p.damage);
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
                        if (!rp.active) continue;
                        if (p.shooterId === rp.id && p.aoeRadius <= 0) continue;

                        const distToHead = Math.sqrt((p.x - rp.x)**2 + (p.y - rp.y)**2);
                        if (distToHead > 300) continue; 

                        const bodies = rp.getAllBodies();
                        for (const b of bodies) {
                            if (this.checkCollision(p, b)) {
                                if (p.type === ProjectileType.MINE && !p.isArmed) continue;

                                if (p.aoeRadius > 0) {
                                    this.createExplosion(p.x, p.y, p.aoeRadius, p.damage, p.shooterId);
                                } else {
                                    EventBus.getInstance().emit(GameEvent.PROJECTILE_HIT, { 
                                        x: p.x, y: p.y, 
                                        projectileType: p.type, 
                                        hitType: 'entity' 
                                    });
                                    
                                    EventBus.getInstance().emit(GameEvent.ENTITY_HIT, {
                                        x: p.x, y: p.y,
                                        damage: p.damage,
                                        targetId: rp.id,
                                        sourceId: p.shooterId || '',
                                        color: rp.color
                                    });

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

    public createExplosion(x: number, y: number, radius: number, damage: number, shooterId: string | null = null, projectileType: ProjectileType | null = null): void {
        if (this.parent.onExplosion) {
            this.parent.onExplosion(x, y, radius, damage);
        }

        const mm = MultiplayerManager.getInstance();
        const isMyExplosion = shooterId === this.parent.myId;

        let shrapnelCount = 0;
        
        if (this.parent.heatMap) {
            this.parent.heatMap.addHeat(x, y, 0.8, radius * 1.5);
            
            // --- WORLD DAMAGE LOGIC ---
            // Direct Tile Destruction for Singleplayer or Host
            const mm = MultiplayerManager.getInstance();
            if (this.parent.myId === 'local' || mm.isHost) {
                // Determine destruction intensity based on explosion radius
                this.parent.heatMap.destroyArea(x, y, radius, true);
                
                // If Host, we might need to sync the results of this destruction
                if (mm.isHost) {
                    const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');
                    const tx = Math.floor(x / tileSize);
                    const ty = Math.floor(y / tileSize);
                    const tileRadius = Math.ceil((radius + 10) / tileSize);

                    // Sync all affected tiles
                    for (let ry = -tileRadius; ry <= tileRadius; ry++) {
                        for (let rx = -tileRadius; rx <= tileRadius; rx++) {
                            const ntx = tx + rx;
                            const nty = ty + ry;
                            if (this.parent.world && ntx >= 0 && ntx < (this.parent.world as any).width && nty >= 0 && nty < (this.parent.world as any).height) {
                                const hpData = this.parent.heatMap.getTileHP(ntx, nty);
                                mm.broadcast(NetworkMessageType.WORLD_UPDATE, {
                                    tx: ntx, ty: nty,
                                    m: (this.parent.world as any).tiles[nty][ntx],
                                    hp: hpData ? Array.from(hpData) : null,
                                    hx: x, hy: y, // Original explosion center for visual sync
                                    pt: (ntx === tx && nty === ty) ? projectileType : null // Only send pt for the center tile to avoid redundant visuals
                                });
                            }
                        }
                    }
                }
            }

            // --- MATERIAL & SHRAPNEL LOGIC ---
            const centerMat = this.parent.heatMap.getMaterialAt(x, y);
            if (centerMat !== MaterialType.NONE) {
                EventBus.getInstance().emit(GameEvent.MATERIAL_HIT, { 
                    x, y, 
                    material: MaterialType[centerMat].toLowerCase() 
                });
            }

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
        }

        // Emit Unified Explosion Event
        EventBus.getInstance().emit(GameEvent.EXPLOSION, { 
            x, y, radius, 
            type: 'large', 
            moltenCount: Math.min(150, shrapnelCount)
        });

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
                const dmg = damage * falloff;
                
                if (this.parent.myId === 'local') {
                    // Singleplayer: damage directly
                    this.parent.player.takeDamage(dmg);
                } else if (isMyExplosion) {
                    // Multiplayer: broadcast hit to myself
                    mm.broadcast(NetworkMessageType.PLAYER_HIT, { 
                        id: this.parent.myId, 
                        damage: dmg, 
                        killerId: shooterId 
                    });
                }
            }
        }

        if (this.parent.remotePlayers) {
            this.parent.remotePlayers.forEach((rp: RemotePlayer) => {
                if (!rp.active) return;
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
}
