import { World } from '../core/World';
import { MaterialType } from '../core/HeatMap';

export interface AcousticResult {
    volume: number;
    distance: number;
    cutoff: number;
    apparentSource: { x: number, y: number };
}

export class SoundRaycaster {
    private static worker: Worker | null = null;
    private static pendingRequests: Map<string, (results: Record<string, AcousticResult>) => void> = new Map();

    public static init() {
        if (!this.worker) {
            this.worker = new Worker(new URL('../workers/acoustic.worker.ts', import.meta.url), { type: 'module' });
            this.worker.onmessage = (e) => {
                if (e.data.type === 'propagationResult') {
                    const cb = this.pendingRequests.get(e.data.requestId);
                    if (cb) {
                        cb(e.data.results);
                        this.pendingRequests.delete(e.data.requestId);
                    }
                }
            };
        }
    }

    public static propagate(
        source: { x: number, y: number, volume: number },
        listeners: Array<{ id: string, x: number, y: number }>,
        world: World
    ): Promise<Record<string, AcousticResult>> {
        this.init();
        const requestId = Math.random().toString(36).substring(7);
        
        return new Promise((resolve) => {
            this.pendingRequests.set(requestId, resolve);

            // Prepare grid data (MaterialTypes)
            const width = world.getWidth();
            const height = world.getHeight();
            const grid = new Uint8Array(width * height);
            
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    grid[y * width + x] = world.getTile(x, y);
                }
            }

            this.worker!.postMessage({
                type: 'propagate',
                requestId,
                source,
                listeners,
                grid,
                width,
                height,
                tileSize: world.getTileSize()
            }, [grid.buffer]);
        });
    }

    // Keep original for synchronous legacy checks if absolutely needed, 
    // but preferred usage is async propagate.
    public static calculateAudiblePaths(
        sourceX: number,
        sourceY: number,
        listenerX: number,
        listenerY: number,
        world: World
    ): any[] {
        return []; // Stubbed to force transition to Worker
    }
}
