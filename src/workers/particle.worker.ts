import { ParticleData } from '../core/particles/ParticleData';
import { ParticleSimulation, WorldCollision } from '../core/particles/ParticleSimulation';

let particleData: ParticleData | null = null;
let worldCollision: WorkerWorldCollision | null = null;
let isHost = true;

class WorkerWorldCollision implements WorldCollision {
    constructor(private width: number, private height: number, private tileSize: number, private tiles: Uint8Array) { }
    isWall(x: number, y: number): boolean {
        const tx = Math.floor(x / this.tileSize);
        const ty = Math.floor(y / this.tileSize);
        if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) return true;
        return this.tiles[ty * this.width + tx] !== 0;
    }
}

self.onmessage = (e: MessageEvent) => {
    const { type, data } = e.data;

    if (type === 'init') {
        const { buffer, worldData, role } = data;
        if (role !== undefined) isHost = (role === 'host' || role === 'single');

        particleData = new ParticleData(buffer);

        if (worldData) {
            worldCollision = new WorkerWorldCollision(
                worldData.width,
                worldData.height,
                worldData.tileSize,
                new Uint8Array(worldData.tilesBuffer)
            );
        }
    }
    else if (type === 'update') {
        if (!particleData || !worldCollision) return;
        const { dt, player, enemies, weather, pixelsPerMeter } = data;

        const events = ParticleSimulation.update(
            dt,
            particleData,
            worldCollision,
            player,
            enemies,
            weather,
            isHost,
            pixelsPerMeter
        );

        // Signal completion and send events
        (self as any).postMessage({
            type: 'updated' // 'updated' is signal for busy flag false
        });

        if (events.damageEvents.length > 0 || events.heatEvents.length > 0) {
            (self as any).postMessage({
                type: 'events',
                data: events
            });
        }
    }
};
