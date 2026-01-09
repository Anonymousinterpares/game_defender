// acoustic.worker.ts - Offloaded sound propagation logic
import { MaterialType } from '../core/HeatMap';

interface WorkerInput {
    type: 'propagate';
    requestId: string;
    source: { x: number, y: number, volume: number };
    listeners: Array<{ id: string, x: number, y: number }>;
    grid: Uint8Array;
    width: number;
    height: number;
    tileSize: number;
}

const MATERIAL_PROPS: Record<number, { absorption: number, cutoff: number, reflection: number }> = {
    [MaterialType.NONE]: { absorption: 0, cutoff: 20000, reflection: 0.1 },
    [MaterialType.WOOD]: { absorption: 0.65, cutoff: 2000, reflection: 0.15 },
    [MaterialType.BRICK]: { absorption: 0.35, cutoff: 6000, reflection: 0.5 },
    [MaterialType.STONE]: { absorption: 0.2, cutoff: 10000, reflection: 0.7 },
    [MaterialType.METAL]: { absorption: 0.05, cutoff: 18000, reflection: 0.95 },
    [MaterialType.INDESTRUCTIBLE]: { absorption: 0.1, cutoff: 15000, reflection: 0.8 }
};

self.onmessage = (e: MessageEvent<WorkerInput>) => {
    if (e.data.type === 'propagate') {
        const { source, listeners, grid, width, height, tileSize, requestId } = e.data;
        
        const startX = Math.max(0, Math.min(width - 1, Math.floor(source.x / tileSize)));
        const startY = Math.max(0, Math.min(height - 1, Math.floor(source.y / tileSize)));
        
        const results: Record<string, any> = {};
        const dists = new Float32Array(width * height).fill(Infinity);
        const parents = new Int32Array(width * height * 2).fill(-1);
        const intensities = new Float32Array(width * height).fill(0);
        const cutoffs = new Float32Array(width * height).fill(20000);
        
        // Simple Min-Heap or just a sorted array would be better, 
        // but for coarse grid (e.g. 50x50), even a basic queue with better logic works.
        // Let's use a simpler Dijkstra for reliability.
        const startIdx = startY * width + startX;
        dists[startIdx] = 0;
        intensities[startIdx] = source.volume;
        cutoffs[startIdx] = 20000; // Start with full range
        
        const queue: number[] = [startIdx];
        const visited = new Uint8Array(width * height);

        while (queue.length > 0) {
            // Pick node with highest intensity (loudest)
            let bestIdx = 0;
            for(let i=1; i<queue.length; i++) {
                if (intensities[queue[i]] > intensities[queue[bestIdx]]) bestIdx = i;
            }
            const u = queue.splice(bestIdx, 1)[0];
            
            if (visited[u]) continue;
            visited[u] = 1;

            const ux = u % width;
            const uy = Math.floor(u / width);
            const intensity = intensities[u];
            const currentCutoff = cutoffs[u];
            
            if (intensity < 0.5) continue; 

            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const vx = ux + dx;
                    const vy = uy + dy;
                    if (vx < 0 || vx >= width || vy < 0 || vy >= height) continue;
                    
                    const v = vy * width + vx;
                    if (visited[v]) continue;

                    const edgeDist = Math.sqrt(dx * dx + dy * dy);
                    const mat = grid[v];
                    const props = MATERIAL_PROPS[mat] || MATERIAL_PROPS[MaterialType.NONE];
                    
                    // Intensity decay: Muffling from walls + Distance falloff
                    // We only apply absorption of the tile we are ENTERING.
                    let newIntensity = intensity * (1 - props.absorption);
                    newIntensity *= (1 / (1 + edgeDist * 0.1)); 

                    if (newIntensity > intensities[v]) {
                        intensities[v] = newIntensity;
                        dists[v] = dists[u] + edgeDist;
                        cutoffs[v] = Math.min(currentCutoff, props.cutoff);
                        parents[v * 2] = ux;
                        parents[v * 2 + 1] = uy;
                        queue.push(v);
                    }
                }
            }
        }

        for (const listener of listeners) {
            const lx = Math.floor(listener.x / tileSize);
            const ly = Math.floor(listener.y / tileSize);
            if (lx < 0 || lx >= width || ly < 0 || ly >= height) continue;

            const lIdx = ly * width + lx;
            if (intensities[lIdx] > 1) {
                const px = parents[lIdx * 2];
                const py = parents[lIdx * 2 + 1];
                
                results[listener.id] = {
                    volume: intensities[lIdx],
                    distance: dists[lIdx] * tileSize,
                    cutoff: cutoffs[lIdx],
                    apparentSource: { 
                        x: (px === -1 ? lx : px) * tileSize + tileSize/2, 
                        y: (py === -1 ? ly : py) * tileSize + tileSize/2 
                    }
                };
            }
        }

        self.postMessage({ type: 'propagationResult', requestId, results });
    }
};