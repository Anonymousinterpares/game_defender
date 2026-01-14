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
import { SegmentComponent } from '../core/ecs/components/SegmentComponent';

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
    playerEntityId?: string;
    spatialGrid: any;
    entityManager?: any;
    onExplosion?: (x: number, y: number, radius: number, damage: number) => void;
    lastKilledBy?: string | null;
}

export class CombatSystem {
    constructor(private parent: CombatParent) { }

    public update(dt: number): void {
        // Redundant - Logic moved to ProjectileSystem and DropSystem
    }

    public findNearestTarget(x: number, y: number, shooterId: string | null, maxDist: number = 1000): any | null {
        if (!this.parent.entityManager || !this.parent.spatialGrid) return null;

        const neighbors = this.parent.spatialGrid.retrieve({
            x: x - maxDist,
            y: y - maxDist,
            w: maxDist * 2,
            h: maxDist * 2
        });

        if (neighbors.length > 0 && ConfigManager.getInstance().get<boolean>('Debug', 'extendedLogs')) {
            console.log(`[CombatSystem] findNearestTarget for ${shooterId}. Neighbors: ${neighbors.length}`);
        }

        let nearest: any = null;
        let minDistSq = maxDist * maxDist;

        for (const other of neighbors) {
            const id = other.id;
            const rootId = this.findRootId(id);

            // ROBUST FIX: Directly compare IDs. 
            // shooterId is now always the firing entity's actual entityId.
            const isActualShooter = rootId === shooterId;

            if (isActualShooter) {
                continue;
            }

            const tagComponent = this.parent.entityManager.getComponent(id, 'tag');
            const tag = tagComponent?.tag;

            if (tag !== 'enemy' && tag !== 'remote_player' && tag !== 'player') continue;

            const transform = this.parent.entityManager.getComponent(id, 'transform');
            if (!transform) continue;

            const health = this.parent.entityManager.getComponent(id, 'health');
            if (health && !health.active) continue;

            const dx = transform.x - x;
            const dy = transform.y - y;
            const distSq = dx * dx + dy * dy;

            if (distSq < minDistSq) {
                minDistSq = distSq;
                nearest = { id, x: transform.x, y: transform.y, rotation: transform.rotation };
            }
        }

        if (nearest) {
            // console.log(`[CombatSystem] Found nearest target: ${nearest.id} at distance ${Math.sqrt(minDistSq).toFixed(1)}`);
        } else {
            // Log if spatial grid returned anything at all
            if (neighbors.length > 0 && ConfigManager.getInstance().get<boolean>('Debug', 'extendedLogs')) {
                console.log(`[CombatSystem] No valid targets among ${neighbors.length} neighbors in query range.`);
            }
        }

        return nearest;
    }

    private checkCollision(a: { x: number, y: number, radius: number }, b: { x: number, y: number, radius: number }): boolean {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = dx * dx + dy * dy;
        const radSum = a.radius + b.radius;
        return distSq < radSum * radSum;
    }

    private calculateDamage(id: string, rawDamage: number, sourceX: number, sourceY: number): number {
        if (!this.parent.entityManager) return rawDamage;

        const ai = this.parent.entityManager.getComponent(id, 'ai');
        const transform = this.parent.entityManager.getComponent(id, 'transform');
        if (ai && ai.dossier && ai.dossier.traits.includes('armored') && transform) {
            const dx = sourceX - transform.x;
            const dy = sourceY - transform.y;
            const angleToSource = Math.atan2(dy, dx);

            let diff = angleToSource - transform.rotation;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;

            if (Math.abs(diff) < Math.PI / 4) {
                return rawDamage * 0.3; // 70% reduction
            }
        }

        return rawDamage;
    }

    public createExplosion(x: number, y: number, radius: number, damage: number, shooterId: string | null = null, projectileType: ProjectileType | null = null, moltenCountOverride: number | null = null): void {
        if (this.parent.onExplosion) {
            this.parent.onExplosion(x, y, radius, damage);
        }

        const mm = (window as any).MultiplayerManagerInstance;
        const isMyExplosion = shooterId === (this.parent.myId || 'local');

        let shrapnelCount = moltenCountOverride !== null ? moltenCountOverride : 0;

        if (this.parent.heatMap) {
            this.parent.heatMap.addHeat(x, y, 0.8, radius * 1.5);

            // --- MATERIAL & SHRAPNEL LOGIC ---
            if (moltenCountOverride === null) {
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
                        const distSq = dx * dx + dy * dy;
                        if (distSq <= scanRadius * scanRadius) {
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

            // --- WORLD DAMAGE LOGIC ---
            if ((this.parent.myId || 'local') === 'local' || (mm && mm.isHost)) {
                this.parent.heatMap.destroyArea(x, y, radius, true);

                if (mm && mm.isHost) {
                    const world = this.parent.world;
                    const tileSize = ConfigManager.getInstance().get<number>('World', 'tileSize');
                    const tx = Math.floor(x / tileSize);
                    const ty = Math.floor(y / tileSize);
                    const tileRadius = Math.ceil((radius + 32) / tileSize);
                    const affectedTiles: any[] = [];

                    for (let ry = -tileRadius; ry <= tileRadius; ry++) {
                        for (let rx = -tileRadius; rx <= tileRadius; rx++) {
                            const ntx = tx + rx;
                            const nty = ty + ry;
                            if (world && ntx >= 0 && ntx < world.getWidth() && nty >= 0 && nty < world.getHeight()) {
                                const hpData = this.parent.heatMap.getTileHP(ntx, nty);
                                if (hpData || world.getTile(ntx, nty) === MaterialType.NONE) {
                                    affectedTiles.push({
                                        tx: ntx, ty: nty,
                                        m: world.getTile(ntx, nty),
                                        hp: hpData ? Array.from(hpData) : null
                                    });
                                }
                            }
                        }
                    }

                    mm.broadcast('ex', {
                        x, y, radius,
                        mc: Math.min(150, shrapnelCount),
                        pt: projectileType,
                        tiles: affectedTiles
                    });
                }
            }
        }

        EventBus.getInstance().emit(GameEvent.EXPLOSION, {
            x, y, radius,
            type: 'large',
            moltenCount: Math.min(150, shrapnelCount)
        });

        // --- DAMAGE LOGIC (ECS based) ---
        if (this.parent.entityManager && this.parent.spatialGrid) {
            const neighbors = this.parent.spatialGrid.retrieve({
                x: x - radius,
                y: y - radius,
                w: radius * 2,
                h: radius * 2
            });

            const affectedEntities = new Set<string>();

            for (const other of neighbors) {
                const dx = other.x - x;
                const dy = other.y - y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < radius + other.radius) {
                    // REDIRECT: Find the actual root head
                    const rootId = this.findRootId(other.id);

                    // EXCLUSION: Skip if it's the shooter themselves (prevent self-damage)
                    const isActualShooter = rootId === shooterId;

                    if (isActualShooter) continue;

                    // Don't damage the same root twice in one explosion
                    if (affectedEntities.has(rootId)) continue;
                    affectedEntities.add(rootId);

                    const health = this.parent.entityManager.getComponent(rootId, 'health');
                    if (health && health.active) {
                        const falloff = 1 - (Math.max(0, dist - other.radius) / radius);
                        const rawDmg = damage * Math.max(0, falloff);

                        // Use the original other.id for armored calculations since it's position/orientation dependent
                        const finalDmg = this.calculateDamage(other.id, rawDmg, x, y);

                        health.health -= finalDmg;
                        health.damageFlash = 0.2;
                        if (health.health <= 0) {
                            health.health = 0;
                            health.active = false;
                        }

                        // Sync for multiplayer: Broadcast if this explosion was caused by our local player entity
                        const tag = this.parent.entityManager.getComponent(rootId, 'tag')?.tag;
                        const isMyExplosionOwn = this.parent.player && shooterId === this.parent.player.id;

                        if (isMyExplosionOwn && (tag === 'remote_player' || tag === 'enemy')) {
                            const mm = (window as any).MultiplayerManagerInstance;
                            if (mm) {
                                mm.broadcast('ph', {
                                    id: rootId,
                                    damage: finalDmg,
                                    killerId: this.parent.myId || 'local'
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    public findRootId(id: string): string {
        if (!this.parent.entityManager) return id;
        let currentId = id;
        let visited = new Set<string>();
        while (visited.size < 100) {
            if (visited.has(currentId)) break;
            visited.add(currentId);
            const segment = this.parent.entityManager.getComponent(currentId, 'segment');
            if (segment && segment.leaderId) {
                currentId = segment.leaderId;
            } else {
                break;
            }
        }
        return currentId;
    }
}
