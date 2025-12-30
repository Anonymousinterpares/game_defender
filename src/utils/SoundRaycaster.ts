import { World } from '../core/World';
import { MaterialType } from '../core/HeatMap';

export interface AudiblePath {
    volume: number;
    pan: number;
    filterCutoff: number;
    distance: number;
}

export class SoundRaycaster {
    private static MAX_BOUNCES = 2;
    private static RAY_COUNT = 16;
    private static STEP_SIZE = 8;
    private static LISTENER_RADIUS = 30;
    private static REFERENCE_DIST = 100;

    private static MATERIAL_PROPS: Record<MaterialType, { absorption: number, cutoff: number }> = {
        [MaterialType.NONE]: { absorption: 0, cutoff: 20000 },
        [MaterialType.WOOD]: { absorption: 0.6, cutoff: 2000 },
        [MaterialType.BRICK]: { absorption: 0.3, cutoff: 6000 },
        [MaterialType.STONE]: { absorption: 0.2, cutoff: 10000 },
        [MaterialType.METAL]: { absorption: 0.05, cutoff: 18000 },
        [MaterialType.INDESTRUCTIBLE]: { absorption: 0.1, cutoff: 15000 }
    };

    public static calculateAudiblePaths(
        sourceX: number,
        sourceY: number,
        listenerX: number,
        listenerY: number,
        world: World
    ): AudiblePath[] {
        const paths: AudiblePath[] = [];

        // 1. Direct Line of Sight Check
        const directPath = this.traceSingleRay(sourceX, sourceY, listenerX, listenerY, world);
        if (directPath) {
            paths.push(directPath);
        }

        // 2. Sample reflections
        const angleStep = (Math.PI * 2) / this.RAY_COUNT;
        for (let i = 0; i < this.RAY_COUNT; i++) {
            const angle = i * angleStep;
            const reflection = this.traceReflectionRay(
                sourceX, sourceY, 
                Math.cos(angle), Math.sin(angle), 
                listenerX, listenerY, 
                world
            );
            if (reflection) {
                paths.push(reflection);
            }
        }

        return paths;
    }

    private static traceSingleRay(sx: number, sy: number, lx: number, ly: number, world: World): AudiblePath | null {
        const dx = lx - sx;
        const dy = ly - sy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.ceil(dist / this.STEP_SIZE);
        
        let muffle = 1.0;
        let cutoff = 20000;

        for (let i = 1; i < steps; i++) {
            const px = sx + (dx / steps) * i;
            const py = sy + (dy / steps) * i;
            if (world.isWall(px, py)) {
                const mat = (world as any).heatMapRef?.getMaterialAt(px, py) ?? MaterialType.STONE;
                const props = this.MATERIAL_PROPS[mat];
                muffle *= (1 - props.absorption);
                cutoff = Math.min(cutoff, props.cutoff);
                
                if (muffle < 0.1) return null; // Too muffled
            }
        }

        const volume = muffle * (this.REFERENCE_DIST / Math.max(this.REFERENCE_DIST, dist));
        const pan = dist > 0 ? Math.max(-1, Math.min(1, (sx - lx) / dist)) : 0;

        return { volume, pan, filterCutoff: cutoff, distance: dist };
    }

    private static traceReflectionRay(
        sx: number, sy: number, 
        vx: number, vy: number, 
        lx: number, ly: number, 
        world: World
    ): AudiblePath | null {
        let currX = sx;
        let currY = sy;
        let dirX = vx;
        let dirY = vy;
        let totalDist = 0;
        let intensity = 1.0;
        let cutoff = 20000;
        
        const maxDist = 800;

        for (let b = 0; b <= this.MAX_BOUNCES; b++) {
            // Move ray
            for (let s = 0; s < 100; s++) { // Max steps per bounce
                currX += dirX * this.STEP_SIZE;
                currY += dirY * this.STEP_SIZE;
                totalDist += this.STEP_SIZE;

                if (totalDist > maxDist) return null;

                // Check hit listener
                const dlx = currX - lx;
                const dly = currY - ly;
                if (dlx * dlx + dly * dly < this.LISTENER_RADIUS * this.LISTENER_RADIUS) {
                    const finalVol = intensity * (this.REFERENCE_DIST / Math.max(this.REFERENCE_DIST, totalDist));
                    // Panning for reflection: arrival direction
                    // If ray is moving right (dirX > 0), it hits from the left.
                    const pan = Math.max(-1, Math.min(1, -dirX)); 
                    return { volume: finalVol, pan, filterCutoff: cutoff, distance: totalDist };
                }

                // Check hit wall
                if (world.isWall(currX, currY)) {
                    // Reflect
                    const mat = (world as any).heatMapRef?.getMaterialAt(currX, currY) ?? MaterialType.STONE;
                    const props = this.MATERIAL_PROPS[mat];
                    intensity *= (1 - props.absorption);
                    cutoff = Math.min(cutoff, props.cutoff);

                    // Find Normal (approximate)
                    let nx = 0, ny = 0;
                    if (!world.isWall(currX - this.STEP_SIZE, currY)) nx = 1;
                    else if (!world.isWall(currX + this.STEP_SIZE, currY)) nx = -1;
                    else if (!world.isWall(currX, currY - this.STEP_SIZE)) ny = 1;
                    else if (!world.isWall(currX, currY + this.STEP_SIZE)) ny = -1;

                    if (nx === 0 && ny === 0) { nx = -dirX; ny = -dirY; } // Corner or stuck

                    // r = d - 2(d.n)n
                    const dot = dirX * nx + dirY * ny;
                    dirX = dirX - 2 * dot * nx;
                    dirY = dirY - 2 * dot * ny;

                    // Step out of wall slightly
                    currX += nx * 2;
                    currY += ny * 2;
                    break; 
                }
            }
        }
        return null;
    }
}
