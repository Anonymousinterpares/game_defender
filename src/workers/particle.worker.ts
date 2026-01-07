import { ParticleType, FLAG_ACTIVE, FLAG_IS_FLAME } from '../core/ParticleConstants';

interface ParticleBuffers {
    x: Float32Array;
    y: Float32Array;
    z: Float32Array;
    prevX: Float32Array;
    prevY: Float32Array;
    prevZ: Float32Array;
    vx: Float32Array;
    vy: Float32Array;
    vz: Float32Array;
    life: Float32Array;
    maxLife: Float32Array;
    radius: Float32Array;
    startRadius: Float32Array;
    type: Uint8Array;
    flags: Uint8Array;
    colorIdx: Uint32Array;
}

let buffers: ParticleBuffers | null = null;
let worldWidth = 0;
let worldHeight = 0;
let tileSize = 0;
let worldTiles: Uint8Array | null = null;
let isHost = true; // Default to host unless told otherwise

self.onmessage = (e: MessageEvent) => {
    const { type, data } = e.data;

    if (type === 'init') {
        const { buffer, worldData, role } = data;
        if (role !== undefined) isHost = (role === 'host' || role === 'single');
        
        // Split the single SAB into individual views
        // MAX_PARTICLES * (13 * 4 + 3 * 4) bytes roughly
        const count = 10000;
        let offset = 0;
        const f32 = (len: number) => {
            const arr = new Float32Array(buffer, offset, len);
            offset += len * 4;
            return arr;
        };
        const u8 = (len: number) => {
            const arr = new Uint8Array(buffer, offset, len);
            offset += len; // Uint8 is 1 byte
            // Keep 4-byte alignment for the next Float32/Uint32
            offset = (offset + 3) & ~3;
            return arr;
        };
        const u32 = (len: number) => {
            const arr = new Uint32Array(buffer, offset, len);
            offset += len * 4;
            return arr;
        };

        buffers = {
            x: f32(count), y: f32(count), z: f32(count),
            prevX: f32(count), prevY: f32(count), prevZ: f32(count),
            vx: f32(count), vy: f32(count), vz: f32(count),
            life: f32(count), maxLife: f32(count),
            radius: f32(count), startRadius: f32(count),
            type: u8(count),
            flags: u8(count),
            colorIdx: u32(count)
        };

        if (worldData) {
            worldWidth = worldData.width;
            worldHeight = worldData.height;
            tileSize = worldData.tileSize;
            worldTiles = new Uint8Array(worldData.tilesBuffer);
        }
    } 
    else if (type === 'update') {
        if (!buffers) return;
        const { dt, player, enemies } = data;
        updateParticles(dt, player, enemies);
        // Signal completion
        (self as any).postMessage({ type: 'updated' });
    }
};

function isWall(wx: number, wy: number): boolean {
    if (!worldTiles) return false;
    const tx = Math.floor(wx / tileSize);
    const ty = Math.floor(wy / tileSize);
    if (tx < 0 || tx >= worldWidth || ty < 0 || ty >= worldHeight) return true;
    const tile = worldTiles[ty * worldWidth + tx];
    return tile !== 0; // MaterialType.NONE is 0
}

function updateParticles(dt: number, player: any, enemies: any[]) {
    if (!buffers) return;
    const count = 10000;
    const b = buffers;

    const damageEvents: { targetIdx: number, damage: number }[] = [];
    const heatEvents: { x: number, y: number, intensity: number, radius: number }[] = [];

    for (let i = 0; i < count; i++) {
        if (!(b.flags[i] & FLAG_ACTIVE)) continue;

        b.prevX[i] = b.x[i];
        b.prevY[i] = b.y[i];
        b.prevZ[i] = b.z[i];

        const pType = b.type[i];
        
        if (pType === ParticleType.STANDARD || pType === ParticleType.MOLTEN) {
            const nextX = b.x[i] + b.vx[i] * dt;
            const nextY = b.y[i] + b.vy[i] * dt;

            const isFlame = b.flags[i] & FLAG_IS_FLAME;
            
            if (isFlame && isWall(nextX, nextY)) {
                b.vx[i] = 0;
                b.vy[i] = 0;
                b.life[i] *= 0.5;
            } else if (pType === ParticleType.MOLTEN && isWall(nextX, nextY)) {
                b.vx[i] *= -0.3;
                b.vy[i] *= -0.3;
            } else {
                b.x[i] = nextX;
                b.y[i] = nextY;
            }

            if (pType === ParticleType.MOLTEN) {
                const gravity = 80;
                b.vz[i] += gravity * dt;
                b.z[i] += b.vz[i] * dt;

                b.vx[i] *= 0.995;
                b.vy[i] *= 0.995;

                if (b.z[i] > 0 && b.vz[i] > 0) {
                    if (b.z[i] !== 0 && isHost) {
                        heatEvents.push({ x: b.x[i], y: b.y[i], intensity: 0.6, radius: 20 });
                    }
                    b.z[i] = 0;
                    b.vz[i] = 0;
                    b.vx[i] = 0;
                    b.vy[i] = 0;
                }

                if (b.z[i] < -2) {
                    // Check collision with player
                    if (player && player.active) {
                        const dx = player.x - b.x[i];
                        const dy = player.y - b.y[i];
                        const rSum = player.radius + b.radius[i];
                        if (dx * dx + dy * dy < rSum * rSum) {
                            damageEvents.push({ targetIdx: -1, damage: 5 }); // -1 for player
                            b.flags[i] &= ~FLAG_ACTIVE;
                        }
                    }
                    // Check enemies
                    if (b.flags[i] & FLAG_ACTIVE) {
                        for (let j = 0; j < enemies.length; j++) {
                            const e = enemies[j];
                            const dx = e.x - b.x[i];
                            const dy = e.y - b.y[i];
                            const rSum = e.radius + b.radius[i];
                            if (dx * dx + dy * dy < rSum * rSum) {
                                damageEvents.push({ targetIdx: j, damage: 5 });
                                b.flags[i] &= ~FLAG_ACTIVE;
                                break;
                            }
                        }
                    }
                }
            } else {
                b.vx[i] *= 0.95;
                b.vy[i] *= 0.95;
            }
        }

        b.life[i] -= dt;
        if (b.life[i] <= 0) {
            b.flags[i] &= ~FLAG_ACTIVE;
        }

        // Visual state updates (color/radius)
        if (b.flags[i] & FLAG_ACTIVE) {
            const lifeRatio = b.life[i] / b.maxLife[i];
            if (b.flags[i] & FLAG_IS_FLAME) {
                b.radius[i] = b.startRadius[i] + (1 - lifeRatio) * 10;
                // Color updates are skipped in worker as Palette is main-thread. 
                // We'll calculate indices based on thresholds.
            }
        }
    }

    if (damageEvents.length > 0 || heatEvents.length > 0) {
        (self as any).postMessage({ type: 'events', data: { damageEvents, heatEvents } });
    }
}
