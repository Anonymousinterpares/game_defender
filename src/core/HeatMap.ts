/// <reference types="vite/client" />
import { SoundManager } from './SoundManager';
import { ConfigManager } from '../config/MasterConfig';
import { FloorDecalManager } from './FloorDecalManager';

export enum MaterialType {
    NONE = 0,
    WOOD = 1,
    BRICK = 2,
    STONE = 3,
    METAL = 4,
    INDESTRUCTIBLE = 5
}

export interface MaterialProperties {
    hp: number;
    flammable: boolean;
    vaporizeTime: number; // seconds at white heat
}

export const MATERIAL_PROPS: Record<MaterialType, MaterialProperties> = {
    [MaterialType.NONE]: { hp: 0, flammable: false, vaporizeTime: 0 },
    [MaterialType.WOOD]: { hp: 10, flammable: true, vaporizeTime: 1 },
    [MaterialType.BRICK]: { hp: 30, flammable: false, vaporizeTime: 10 },
    [MaterialType.STONE]: { hp: 100, flammable: false, vaporizeTime: 15 },
    [MaterialType.METAL]: { hp: 120, flammable: false, vaporizeTime: 5 },
    [MaterialType.INDESTRUCTIBLE]: { hp: 999999, flammable: false, vaporizeTime: 999999 }
};

export class HeatMap {
    private heatData: Map<string, Float32Array> = new Map();
    private activeTiles: Set<string> = new Set();
    private scorchData: Map<string, Uint8Array> = new Map(); 
    
    // New material and HP data
    private materialData: Map<string, Uint8Array> = new Map();
    private hpData: Map<string, Float32Array> = new Map();
    private fireData: Map<string, Float32Array> = new Map(); // intensity of fire
    private moltenData: Map<string, Float32Array> = new Map(); // molten intensity for METAL
    private whiteHeatTime: Map<string, Float32Array> = new Map(); // how long sub-tile is white-hot
    
    private subDiv: number = 10; // 10x10 sub-elements per tile
    private decayRate: number = 0.0125; // Decreased 4x (from 0.05)
    private spreadRate: number = 0.1; 
    
    private lastSimTime: number = 0;
    private simInterval: number = 3; 
    private frameCount: number = 0;
    private fireAsset: HTMLImageElement | null = null;
    private worldRef: any = null;
    private widthTiles: number = 0;
    private heightTiles: number = 0;
    
    // Track tiles that became inactive to sync deactivation to clients
    private recentlyDeactivated: Set<string> = new Set();

    private scratchCanvas: HTMLCanvasElement | null = null;
    private scratchCtx: CanvasRenderingContext2D | null = null;

    constructor(private tileSize: number) {
        // Pre-load fire spritesheet if configured
        const useSprite = ConfigManager.getInstance().get<boolean>('Fire', 'isFireSpritesheet');
        if (useSprite) {
            this.fireAsset = new Image();
            this.fireAsset.src = `${import.meta.env.BASE_URL}assets/visuals/fire_spritesheet.svg`;
            this.fireAsset.onerror = () => {
                console.warn("Fire spritesheet not found, falling back to procedural.");
                this.fireAsset = null;
            };
        }
    }

    public setWorldRef(world: any): void {
        this.worldRef = world;
        this.widthTiles = world.getWidth();
        this.heightTiles = world.getHeight();
    }

    public isSubTileBurning(worldX: number, worldY: number): boolean {
        const tx = Math.floor(worldX / this.tileSize);
        const ty = Math.floor(worldY / this.tileSize);
        const fData = this.fireData.get(`${tx},${ty}`);
        if (!fData) return false;

        const subX = Math.floor((worldX % this.tileSize) / (this.tileSize / this.subDiv));
        const subY = Math.floor((worldY % this.tileSize) / (this.tileSize / this.subDiv));
        const idx = subY * this.subDiv + subX;
        return fData[idx] > 0.1; // Lowered threshold for ignition
    }

    public checkFireArea(x: number, y: number, radius: number): boolean {
        // Check center and 4 points around the radius for fire
        const points = [
            {x, y},
            {x: x - radius, y},
            {x: x + radius, y},
            {x, y: y - radius},
            {x, y: y + radius}
        ];
        
        for (const p of points) {
            if (this.isSubTileBurning(p.x, p.y)) return true;
        }
        return false;
    }

    public getMaxIntensityArea(x: number, y: number, radius: number): number {
        const points = [
            {x, y},
            {x: x - radius, y},
            {x: x + radius, y},
            {x, y: y - radius},
            {x, y: y + radius}
        ];
        
        let max = 0;
        for (const p of points) {
            max = Math.max(max, this.getIntensityAt(p.x, p.y));
        }
        return max;
    }


    public setMaterial(tx: number, ty: number, material: MaterialType): void {
        const key = `${tx},${ty}`;
        const mData = new Uint8Array(this.subDiv * this.subDiv).fill(material);
        this.materialData.set(key, mData);
        
        const hp = MATERIAL_PROPS[material].hp;
        const hData = new Float32Array(this.subDiv * this.subDiv).fill(hp);
        this.hpData.set(key, hData);
    }

    public isSubTileDestroyed(worldX: number, worldY: number): boolean {
        const tx = Math.floor(worldX / this.tileSize);
        const ty = Math.floor(worldY / this.tileSize);
        const hp = this.hpData.get(`${tx},${ty}`);
        if (!hp) return false;

        const subX = Math.floor((worldX % this.tileSize) / (this.tileSize / this.subDiv));
        const subY = Math.floor((worldY % this.tileSize) / (this.tileSize / this.subDiv));
        const idx = subY * this.subDiv + subX;
        return hp[idx] <= 0;
    }

    public isTileMostlyDestroyed(tx: number, ty: number): boolean {
        const hData = this.hpData.get(`${tx},${ty}`);
        if (!hData) return false;
        
        let destroyedCount = 0;
        for (let i = 0; i < hData.length; i++) {
            if (hData[i] <= 0) destroyedCount++;
        }
        return destroyedCount > (hData.length * 0.8);
    }

    public getFireClusters(gridSize: number): {x: number, y: number, intensity: number, color: string}[] {
        const clusters: Map<string, {x: number, y: number, intensity: number, count: number, r: number, g: number, b: number}> = new Map();
        const fireColor = { r: 255, g: 102, b: 0 }; // Default fire orange

        this.activeTiles.forEach(key => {
            const fData = this.fireData.get(key);
            const hData = this.heatData.get(key);
            if (!fData && !hData) return;

            const [tx, ty] = key.split(',').map(Number);
            const worldX = tx * this.tileSize;
            const worldY = ty * this.tileSize;

            const dataLen = fData ? fData.length : (hData ? hData.length : 0);
            for (let i = 0; i < dataLen; i++) {
                const fire = fData ? fData[i] : 0;
                const heat = hData ? hData[i] : 0;
                
                // Lower threshold to 0.3 for red glow on heated walls
                if (fire > 0.1 || heat > 0.3) {
                    const subX = i % this.subDiv;
                    const subY = Math.floor(i / this.subDiv);
                    const px = worldX + (subX + 0.5) * (this.tileSize / this.subDiv);
                    const py = worldY + (subY + 0.5) * (this.tileSize / this.subDiv);

                    const cx = Math.floor(px / gridSize);
                    const cy = Math.floor(py / gridSize);
                    const cKey = `${cx},${cy}`;

                    let cluster = clusters.get(cKey);
                    if (!cluster) {
                        cluster = { x: 0, y: 0, intensity: 0, count: 0, r: 0, g: 0, b: 0 };
                        clusters.set(cKey, cluster);
                    }
                    
                    cluster.x += px;
                    cluster.y += py;
                    
                    const mData = this.moltenData.get(key);
                    const molten = mData ? mData[i] : 0;
                    const inst = Math.max(fire, (heat - 0.2) * 1.5, molten);
                    cluster.intensity += inst;
                    cluster.count++;

                    // Color mix
                    if (fire > 0.1) {
                        cluster.r += fireColor.r; cluster.g += fireColor.g; cluster.b += fireColor.b;
                    } else if (molten > 0.1) {
                        cluster.r += 255; cluster.g += 170; cluster.b += 0; // Molten gold/orange
                    } else {
                        const hc = this.getHeatColorComponents(heat);
                        cluster.r += hc.r; cluster.g += hc.g; cluster.b += hc.b;
                    }
                }
            }
        });

        return Array.from(clusters.values()).map(c => ({
            x: c.x / c.count,
            y: c.y / c.count,
            intensity: c.intensity / c.count,
            color: `rgb(${Math.floor(c.r/c.count)}, ${Math.floor(c.g/c.count)}, ${Math.floor(c.b/c.count)})`
        }));
    }

    private getHeatColorComponents(intensity: number): {r: number, g: number, b: number} {
        if (intensity < 0.4) {
            const r = Math.floor(100 + 155 * (intensity / 0.4));
            return { r, g: 0, b: 0 };
        } else if (intensity < 0.8) {
            const g = Math.floor(255 * ((intensity - 0.4) / 0.4));
            return { r: 255, g, b: 0 };
        } else {
            const b = Math.floor(255 * ((intensity - 0.8) / 0.2));
            return { r: 255, g: 255, b };
        }
    }

    public addHeat(worldX: number, worldY: number, amount: number, radius: number): void {
        const tx = Math.floor(worldX / this.tileSize);
        const ty = Math.floor(worldY / this.tileSize);
        
        const tileRadius = Math.ceil(radius / this.tileSize);
        for (let ry = -tileRadius; ry <= tileRadius; ry++) {
            for (let rx = -tileRadius; rx <= tileRadius; rx++) {
                this.applyHeatToTile(tx + rx, ty + ry, worldX, worldY, amount, radius);
            }
        }
    }

    private applyHeatToTile(tx: number, ty: number, hitX: number, hitY: number, amount: number, radius: number): void {
        // Optimization & Visual: Disable heat on world boundaries
        if (tx <= 0 || tx >= this.widthTiles - 1 || ty <= 0 || ty >= this.heightTiles - 1) {
            return;
        }

        const key = `${tx},${ty}`;
        let data = this.heatData.get(key);
        if (!data) {
            data = new Float32Array(this.subDiv * this.subDiv);
            this.heatData.set(key, data);
        }
        
        this.activeTiles.add(key);
        
        const tileWorldX = tx * this.tileSize;
        const tileWorldY = ty * this.tileSize;
        const subSize = this.tileSize / this.subDiv;
        const mData = this.materialData.get(key);
        const hData = this.hpData.get(key);

        for (let i = 0; i < data.length; i++) {
            if (hData && hData[i] <= 0) continue;

            const subX = i % this.subDiv;
            const subY = Math.floor(i / this.subDiv);
            const centerX = tileWorldX + (subX + 0.5) * subSize;
            const centerY = tileWorldY + (subY + 0.5) * subSize;

            const dx = centerX - hitX;
            const dy = centerY - hitY;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < radius) {
                const effect = (1 - dist/radius) * amount;
                data[i] = Math.min(1.0, data[i] + effect);
                
                this.applyScorch(tx, ty, i);

                // Wood Flammability
                if (data[i] > 0.6 && mData && MATERIAL_PROPS[mData[i] as MaterialType].flammable) {
                    this.ignite(tx, ty, i);
                }
            }
        }
    }

    private applyScorch(tx: number, ty: number, idx: number): void {
        const key = `${tx},${ty}`;
        let sData = this.scorchData.get(key);
        if (!sData) {
            sData = new Uint8Array(this.subDiv * this.subDiv);
            this.scorchData.set(key, sData);
        }
        if (sData[idx] === 0) {
            sData[idx] = 1;
            if (this.worldRef) this.worldRef.notifyTileChange(tx, ty);
        }
    }

    private ignite(tx: number, ty: number, idx: number): void {
        // Optimization: Disable fire/heat on world boundaries
        if (tx <= 0 || tx >= this.widthTiles - 1 || ty <= 0 || ty >= this.heightTiles - 1) {
            return;
        }

        const key = `${tx},${ty}`;
        let fData = this.fireData.get(key);
        if (!fData) {
            fData = new Float32Array(this.subDiv * this.subDiv);
            this.fireData.set(key, fData);
        }
        if (fData[idx] === 0) fData[idx] = 0.1;
        this.activeTiles.add(key);
    }

    public forceIgniteArea(worldX: number, worldY: number, radius: number): void {
        const tx = Math.floor(worldX / this.tileSize);
        const ty = Math.floor(worldY / this.tileSize);
        const tileRadius = Math.ceil(radius / this.tileSize);

        for (let ry = -tileRadius; ry <= tileRadius; ry++) {
            for (let rx = -tileRadius; rx <= tileRadius; rx++) {
                this.igniteInTile(tx + rx, ty + ry, worldX, worldY, radius);
            }
        }
    }

    private igniteInTile(tx: number, ty: number, hitX: number, hitY: number, radius: number): void {
        const key = `${tx},${ty}`;
        const mData = this.materialData.get(key);
        const hData = this.hpData.get(key);
        if (!mData || !hData) return;

        const tileWorldX = tx * this.tileSize;
        const tileWorldY = ty * this.tileSize;
        const subSize = this.tileSize / this.subDiv;

        for (let i = 0; i < mData.length; i++) {
            if (hData[i] <= 0 || !MATERIAL_PROPS[mData[i] as MaterialType].flammable) continue;

            const subX = i % this.subDiv;
            const subY = Math.floor(i / this.subDiv);
            const centerX = tileWorldX + (subX + 0.5) * subSize;
            const centerY = tileWorldY + (subY + 0.5) * subSize;

            const dx = centerX - hitX;
            const dy = centerY - hitY;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < radius) {
                // Only ignite if it's on the surface (exposed to air/destroyed sub-tile)
                if (this.isSubTileSurface(tx, ty, i)) {
                    this.ignite(tx, ty, i);
                    this.applyScorch(tx, ty, i);
                }
            }
        }
    }

    private isSubTileSurface(tx: number, ty: number, subIdx: number): boolean {
        const sx = subIdx % this.subDiv;
        const sy = Math.floor(subIdx / this.subDiv);

        const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [nx, ny] of neighbors) {
            const nsx = sx + nx;
            const nsy = sy + ny;

            let nKey = `${tx},${ty}`;
            let nTargetSx = nsx;
            let nTargetSy = nsy;

            if (nsx < 0 || nsx >= this.subDiv || nsy < 0 || nsy >= this.subDiv) {
                const ntx = tx + (nsx < 0 ? -1 : (nsx >= this.subDiv ? 1 : 0));
                const nty = ty + (nsy < 0 ? -1 : (nsy >= this.subDiv ? 1 : 0));
                nKey = `${ntx},${nty}`;
                nTargetSx = (nsx + this.subDiv) % this.subDiv;
                nTargetSy = (nsy + this.subDiv) % this.subDiv;
            }

            const nhData = this.hpData.get(nKey);
            // If neighbor tile doesn't exist (air) or neighbor sub-tile is destroyed, it's a surface
            if (!nhData || nhData[nTargetSy * this.subDiv + nTargetSx] <= 0) {
                return true;
            }
        }
        return false;
    }

    public destroyArea(worldX: number, worldY: number, radius: number, isIrregular: boolean = false): void {
        const tx = Math.floor(worldX / this.tileSize);
        const ty = Math.floor(worldY / this.tileSize);
        const tileRadius = Math.ceil((radius + 10) / this.tileSize);

        for (let ry = -tileRadius; ry <= tileRadius; ry++) {
            for (let rx = -tileRadius; rx <= tileRadius; rx++) {
                this.destroyInTile(tx + rx, ty + ry, worldX, worldY, radius, isIrregular);
            }
        }
    }

    private destroyInTile(tx: number, ty: number, hitX: number, hitY: number, radius: number, isIrregular: boolean): void {
        const key = `${tx},${ty}`;
        const hData = this.hpData.get(key);
        const mData = this.materialData.get(key);
        if (!hData || !mData) return;

        const tileWorldX = tx * this.tileSize;
        const tileWorldY = ty * this.tileSize;
        const subSize = this.tileSize / this.subDiv;

        for (let i = 0; i < hData.length; i++) {
            if (hData[i] <= 0 || mData[i] === MaterialType.INDESTRUCTIBLE) continue;

            const subX = i % this.subDiv;
            const subY = Math.floor(i / this.subDiv);
            const centerX = tileWorldX + (subX + 0.5) * subSize;
            const centerY = tileWorldY + (subY + 0.5) * subSize;

            const dx = centerX - hitX;
            const dy = centerY - hitY;
            const dist = Math.sqrt(dx*dx + dy*dy);

            let effectiveRadius = radius;
            if (isIrregular) {
                // Add star-like/irregular noise (0 to 10 sub-tiles extra)
                const angle = Math.atan2(dy, dx);
                const noise = (Math.sin(angle * 5) + Math.cos(angle * 3)) * 5; 
                effectiveRadius += noise;
            }

            if (dist < effectiveRadius) {
                hData[i] = 0;
                if (this.worldRef) {
                    this.worldRef.markMeshDirty();
                    this.worldRef.notifyTileChange(tx, ty);
                    this.worldRef.checkTileDestruction(tx, ty);
                }
                // Removed clearing of heat/fire here. 
                // Heat should persist as 'residue' or turn into molten metal.
            } else if (dist < effectiveRadius + subSize * 2) {
                // Carbonization border around destroyed area
                this.applyScorch(tx, ty, i);
            }
        }
    }

    public update(dt: number): void {
        this.frameCount++;
        if (this.frameCount % this.simInterval !== 0) return;

        const effectiveDT = dt * this.simInterval;
        const toRemove: string[] = [];
        const soundMgr = SoundManager.getInstance();

        this.activeTiles.forEach(key => {
            const [tx, ty] = key.split(',').map(Number);
            
            // Skip boundaries
            if (tx <= 0 || tx >= this.widthTiles - 1 || ty <= 0 || ty >= this.heightTiles - 1) {
                this.activeTiles.delete(key);
                this.recentlyDeactivated.add(key);
                return;
            }

            const data = this.heatData.get(key);
            const fData = this.fireData.get(key);
            const mlData = this.moltenData.get(key);
            const mData = this.materialData.get(key);
            const hData = this.hpData.get(key);
            const wData = this.whiteHeatTime.get(key) || new Float32Array(this.subDiv * this.subDiv);
            if (!this.whiteHeatTime.has(key)) this.whiteHeatTime.set(key, wData);

            let hasActivity = false;
            let burningSubTiles = 0;

            const nextData = data ? new Float32Array(data) : new Float32Array(this.subDiv * this.subDiv);
            const nextFire = fData ? new Float32Array(fData) : null;
            const nextMolten = mlData ? new Float32Array(mlData) : (this.hasMetal(mData) ? new Float32Array(this.subDiv * this.subDiv) : null);

            for (let y = 0; y < this.subDiv; y++) {
                for (let x = 0; x < this.subDiv; x++) {
                    const idx = y * this.subDiv + x;
                    const isDestroyed = hData && hData[idx] <= 0;
                    const material = mData ? mData[idx] : MaterialType.NONE;

                    // --- HEAT LOGIC ---
                    const val = nextData[idx];
                    if (val > 0) {
                        let sum = val;
                        let count = 1;
                        const neighbors = [[-1,0], [1,0], [0,-1], [0,1]];
                        for (const [nx, ny] of neighbors) {
                            const nIdx = (y + ny) * this.subDiv + (x + nx);
                            if (x+nx >= 0 && x+nx < this.subDiv && y+ny >= 0 && y+ny < this.subDiv) {
                                sum += data![nIdx];
                                count++;
                            }
                        }
                        const avg = sum / count;
                        nextData[idx] = val + (avg - val) * this.spreadRate;
                        nextData[idx] = Math.max(0, nextData[idx] - this.decayRate * effectiveDT);
                        if (nextData[idx] > 0.01) hasActivity = true;

                        // Vaporization logic
                        if (nextData[idx] > 0.95 && !isDestroyed) {
                            wData[idx] += effectiveDT;
                            const mat = material as MaterialType;
                            if (wData[idx] >= MATERIAL_PROPS[mat].vaporizeTime) {
                                if (hData) hData[idx] = 0;
                                if (this.worldRef) {
                                    this.worldRef.markMeshDirty();
                                    this.worldRef.notifyTileChange(tx, ty);
                                    this.worldRef.checkTileDestruction(tx, ty);
                                }
                                // If metal vaporizes, it IMMEDIATELY turns into a full molten puddle
                                if (mat === MaterialType.METAL && nextMolten) {
                                    nextMolten[idx] = 1.0;
                                    hasActivity = true;
                                }
                                nextData[idx] = 0.5; // Residue heat
                            }
                        } else {
                            wData[idx] = Math.max(0, wData[idx] - effectiveDT);
                        }
                    }

                    // --- METAL MELTING (Wall as Source) ---
                    if (material === MaterialType.METAL && nextData[idx] > 0.5 && !isDestroyed) {
                        // Hot wall leaks molten metal into empty/destroyed neighbors
                        // Doubled leak rate (0.8 vs 0.4) to increase area
                        const leakAmount = (nextData[idx] - 0.4) * 0.8 * effectiveDT;
                        const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1,-1], [1,1], [-1,1], [1,-1]];
                        
                        for (const [nx, ny] of neighbors) {
                            let nx_sub = x + nx;
                            let ny_sub = y + ny;
                            let nKey = key;

                            if (nx_sub < 0 || nx_sub >= this.subDiv || ny_sub < 0 || ny_sub >= this.subDiv) {
                                const ntx = tx + (nx_sub < 0 ? -1 : (nx_sub >= this.subDiv ? 1 : 0));
                                const nty = ty + (ny_sub < 0 ? -1 : (ny_sub >= this.subDiv ? 1 : 0));
                                nKey = `${ntx},${nty}`;
                                nx_sub = (nx_sub + this.subDiv) % this.subDiv;
                                ny_sub = (ny_sub + this.subDiv) % this.subDiv;
                            }

                            const nhData = this.hpData.get(nKey);
                            const nIdx = ny_sub * this.subDiv + nx_sub;
                            
                            // ONLY leak into empty/destroyed space
                            if (!nhData || nhData[nIdx] <= 0) {
                                let nmData = this.moltenData.get(nKey);
                                if (!nmData) {
                                    nmData = new Float32Array(this.subDiv * this.subDiv);
                                    this.moltenData.set(nKey, nmData);
                                    this.activeTiles.add(nKey);
                                }
                                nmData[nIdx] = Math.min(2.0, nmData[nIdx] + leakAmount);
                            }
                        }
                    }

                    // --- MOLTEN LOGIC (Cooling, Spreading & Baking) ---
                    // Only sub-tiles with NO HP (empty/destroyed) can hold/process puddles
                    if (nextMolten && nextMolten[idx] > 0 && isDestroyed) {
                        hasActivity = true;

                        const pressure = nextMolten[idx] + (nextData[idx] * 0.5);
                        if (pressure > 0.15) { // Lowered threshold for easier flow
                            // Diagonal neighbors added for corner rounding
                            const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1,-1], [1,1], [-1,1], [1,-1]];
                            if (Math.random() < 0.5) neighbors.reverse();
                            
                            for (const [nx, ny] of neighbors) {
                                let nx_sub = x + nx;
                                let ny_sub = y + ny;
                                let nKey = key;

                                if (nx_sub < 0 || nx_sub >= this.subDiv || ny_sub < 0 || ny_sub >= this.subDiv) {
                                    const ntx = tx + (nx_sub < 0 ? -1 : (nx_sub >= this.subDiv ? 1 : 0));
                                    const nty = ty + (ny_sub < 0 ? -1 : (ny_sub >= this.subDiv ? 1 : 0));
                                    nKey = `${ntx},${nty}`;
                                    nx_sub = (nx_sub + this.subDiv) % this.subDiv;
                                    ny_sub = (ny_sub + this.subDiv) % this.subDiv;
                                }

                                const nIdx = ny_sub * this.subDiv + nx_sub;
                                const nhData = this.hpData.get(nKey);
                                
                                // Spill only into other empty spaces
                                if (!nhData || nhData[nIdx] <= 0) {
                                    let n_nmData = this.moltenData.get(nKey);
                                    if (!n_nmData) {
                                        n_nmData = new Float32Array(this.subDiv * this.subDiv);
                                        this.moltenData.set(nKey, n_nmData);
                                        this.activeTiles.add(nKey);
                                    }

                                    // Flow rate doubled again (2.0 vs 1.0) to increase spread
                                    const flowRate = 2.0 * (1 + nextData[idx]); 
                                    const spreadAmount = (pressure - 0.05) * flowRate * effectiveDT;
                                    
                                    if (spreadAmount > 0.001) {
                                        n_nmData[nIdx] = Math.min(2.0, n_nmData[nIdx] + spreadAmount);
                                        nextMolten[idx] -= spreadAmount * 0.9;
                                    }
                                }
                            }
                        }

                        // Bake into ground if cooled
                        if (nextData[idx] < 0.2) {
                            const worldX = tx * this.tileSize + (x + 0.5) * (this.tileSize / this.subDiv);
                            const worldY = ty * this.tileSize + (y + 0.5) * (this.tileSize / this.subDiv);
                            // Decal size proportional to volume
                            FloorDecalManager.getInstance().addCooledMetalMark(worldX, worldY, (this.tileSize / this.subDiv) * (0.5 + nextMolten[idx] * 2.0));
                            nextMolten[idx] = 0;
                        }
                    }

                    // --- FIRE LOGIC (WOOD ONLY) ---
                    if (nextFire && material === MaterialType.WOOD) {
                        if (nextFire[idx] > 0) {
                            hasActivity = true;
                            burningSubTiles++;
                            nextFire[idx] += effectiveDT * 0.5; // Fire grows
                            nextData[idx] = Math.min(1.0, nextData[idx] + nextFire[idx] * 0.2); // Fire heats up tile
                            
                            // Damage block
                            if (hData) hData[idx] -= effectiveDT * 10; // 1 second to destroy

                            // Spread fire every 100ms per layer (approx)
                            if (nextFire[idx] > 0.3) {
                                const neighbors = [[-1,0], [1,0], [0,-1], [0,1]];
                                for (const [nx, ny] of neighbors) {
                                    const nIdx = (y + ny) * this.subDiv + (x + nx);
                                    if (x+nx >= 0 && x+nx < this.subDiv && y+ny >= 0 && y+ny < this.subDiv) {
                                        if (nextFire[nIdx] === 0 && hData && hData[nIdx] > 0) {
                                            nextFire[nIdx] = 0.05;
                                        }
                                    }
                                }
                            }

                            if (hData && hData[idx] <= 0) {
                                if (this.worldRef) {
                                    this.worldRef.markMeshDirty();
                                    this.worldRef.notifyTileChange(tx, ty);
                                }
                                nextFire[idx] = 0;
                                nextData[idx] = 0;
                            }
                        }
                    }
                }
            }

            // Trigger fire sound for this tile if it's burning
            if (burningSubTiles > 0) {
                const worldX = tx * this.tileSize + this.tileSize / 2;
                const worldY = ty * this.tileSize + this.tileSize / 2;
                soundMgr.updateAreaSound('fire', worldX, worldY, burningSubTiles);
            }
            
            if (data) data.set(nextData);
            if (fData && nextFire) fData.set(nextFire);
            if (nextMolten) {
                // Only save if there's actual molten metal
                let hasMolten = false;
                for(let i=0; i<nextMolten.length; i++) if(nextMolten[i] > 0) { hasMolten = true; break; }
                if (hasMolten) this.moltenData.set(key, nextMolten);
                else this.moltenData.delete(key);
            }
            if (!hasActivity) {
                toRemove.push(key);
                const mm = (window as any).MultiplayerManager?.getInstance();
                if (!mm || mm.isHost) {
                    this.recentlyDeactivated.add(key);
                }
            }
        });

        toRemove.forEach(k => this.activeTiles.delete(k));
    }

    private hasMetal(mData: Uint8Array | undefined): boolean {
        if (!mData) return false;
        for (let i = 0; i < mData.length; i++) {
            if (mData[i] === MaterialType.METAL) return true;
        }
        return false;
    }

    public render(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number): void {
        const viewW = ctx.canvas.width;
        const viewH = ctx.canvas.height;
        const time = performance.now() * 0.001;

        if (!this.scratchCanvas) {
            this.scratchCanvas = document.createElement('canvas');
            this.scratchCanvas.width = this.subDiv;
            this.scratchCanvas.height = this.subDiv;
            this.scratchCtx = this.scratchCanvas.getContext('2d')!;
        }

        const sCtx = this.scratchCtx!;
        const sCanv = this.scratchCanvas!;

        this.activeTiles.forEach(key => {
            const [tx, ty] = key.split(',').map(Number);
            const worldX = tx * this.tileSize;
            const worldY = ty * this.tileSize;

            if (worldX + this.tileSize < cameraX || worldX > cameraX + viewW ||
                worldY + this.tileSize < cameraY || worldY > cameraY + viewH) return;

            const heatData = this.heatData.get(key);
            const fireData = this.fireData.get(key);
            const hData = this.hpData.get(key);

            if (!heatData && !fireData) return;

            // 1. Render Blended Heat Glow
            if (heatData) {
                sCtx.clearRect(0, 0, this.subDiv, this.subDiv);
                let hasSignificantHeat = false;
                
                const imgData = sCtx.createImageData(this.subDiv, this.subDiv);
                for (let i = 0; i < heatData.length; i++) {
                    const h = heatData[i];
                    if (h > 0.4 && hData && hData[i] > 0) {
                        hasSignificantHeat = true;
                        const color = this.getHeatColorComponents(h);
                        const alpha = Math.floor((h < 0.8 ? (0.4 + h * 0.6) : 1.0) * 255);
                        const idx = i * 4;
                        imgData.data[idx] = color.r;
                        imgData.data[idx+1] = color.g;
                        imgData.data[idx+2] = color.b;
                        imgData.data[idx+3] = alpha;
                    }
                }

                if (hasSignificantHeat) {
                    sCtx.putImageData(imgData, 0, 0);
                    
                    ctx.save();
                    ctx.imageSmoothingEnabled = true;
                    ctx.drawImage(sCanv, worldX, worldY, this.tileSize, this.tileSize);
                    ctx.restore();
                }
            }

            // 2. Render Molten Metal Puddles
            const mld = this.moltenData.get(key);
            if (mld) {
                sCtx.clearRect(0, 0, this.subDiv, this.subDiv);
                let hasMolten = false;
                
                const imgData = sCtx.createImageData(this.subDiv, this.subDiv);
                for (let i = 0; i < mld.length; i++) {
                    const m = mld[i];
                    if (m > 0.05) {
                        hasMolten = true;
                        const alpha = Math.floor(Math.min(1.0, m) * 255);
                        const idx = i * 4;
                        imgData.data[idx] = 255;
                        imgData.data[idx+1] = 200;
                        imgData.data[idx+2] = 0;
                        imgData.data[idx+3] = alpha;
                    }
                }

                if (hasMolten) {
                    sCtx.putImageData(imgData, 0, 0);
                    
                    ctx.save();
                    ctx.imageSmoothingEnabled = true;
                    // Stable alpha for puddles (no flickering)
                    const staticAlpha = 0.95;
                    
                    // Layer 1: Outer Glow (Soft & Wide)
                    ctx.globalAlpha = staticAlpha * 0.5;
                    ctx.shadowBlur = 15; // Increased blur for rounding
                    ctx.shadowColor = '#ff6600';
                    ctx.drawImage(sCanv, worldX - 3, worldY - 3, this.tileSize + 6, this.tileSize + 6);
                    
                    // Layer 2: Inner Liquid Core
                    ctx.shadowBlur = 0;
                    ctx.globalAlpha = staticAlpha;
                    ctx.drawImage(sCanv, worldX - 1, worldY - 1, this.tileSize + 2, this.tileSize + 2);
                    
                    ctx.restore();
                }
            }

            // 3. Render Fire
            if (fireData) {
                const subSize = this.tileSize / this.subDiv;
                for (let i = 0; i < fireData.length; i++) {
                    const fire = fireData[i];
                    if (fire > 0 && hData && hData[i] > 0) {
                        const sx = i % this.subDiv;
                        const sy = Math.floor(i / this.subDiv);
                        const rx = worldX + sx * subSize;
                        const ry = worldY + sy * subSize;

                        if (this.fireAsset && this.fireAsset.complete && this.fireAsset.naturalWidth > 0) {
                            const frameCount = 8;
                            const frame = Math.floor((time * 15 + i) % frameCount);
                            const fw = this.fireAsset.width / frameCount;
                            const fh = this.fireAsset.height;
                            const fx = frame * fw;
                            ctx.drawImage(this.fireAsset, fx, 0, fw, fh, rx - subSize*0.5, ry - subSize, subSize*2, subSize*2);
                        } else {
                            // Blended procedural fire fallback
                            const pulse = 0.6 + Math.sin(time * 30 + i) * 0.4;
                            const grad = ctx.createRadialGradient(rx + subSize/2, ry + subSize/2, 0, rx + subSize/2, ry + subSize/2, subSize * 1.5);
                            grad.addColorStop(0, `rgba(255, 200, 0, ${fire * pulse})`);
                            grad.addColorStop(0.5, `rgba(255, 50, 0, ${fire * pulse * 0.5})`);
                            grad.addColorStop(1, 'rgba(255, 0, 0, 0)');
                            ctx.fillStyle = grad;
                            ctx.fillRect(rx - subSize, ry - subSize, subSize * 3, subSize * 3);
                        }

                        if (Math.random() < 0.1 * fire) {
                            ctx.fillStyle = '#fff';
                            ctx.fillRect(rx + Math.random() * subSize, ry - Math.random() * 10, 1, 1);
                        }
                    }
                }
            }
        });
    }

    private getHeatColor(intensity: number): string {
        if (intensity < 0.4) {
            const r = Math.floor(100 + 155 * (intensity / 0.4));
            return `rgba(${r}, 0, 0, ${0.4 + intensity * 0.6})`;
        } else if (intensity < 0.8) {
            const g = Math.floor(255 * ((intensity - 0.4) / 0.4));
            return `rgba(255, ${g}, 0, 0.9)`;
        } else {
            const b = Math.floor(255 * ((intensity - 0.8) / 0.2));
            return `rgba(255, 255, ${b}, 1.0)`;
        }
    }

    public getIntensityAt(worldX: number, worldY: number): number {
        const tx = Math.floor(worldX / this.tileSize);
        const ty = Math.floor(worldY / this.tileSize);
        const data = this.heatData.get(`${tx},${ty}`);
        if (!data) return 0;

        const subX = Math.floor((worldX % this.tileSize) / (this.tileSize / this.subDiv));
        const subY = Math.floor((worldY % this.tileSize) / (this.tileSize / this.subDiv));
        // Return heat even if sub-tile is destroyed (residue heat)
        return data[subY * this.subDiv + subX] || 0;
    }

    public getMoltenAt(worldX: number, worldY: number): number {
        const tx = Math.floor(worldX / this.tileSize);
        const ty = Math.floor(worldY / this.tileSize);
        const data = this.moltenData.get(`${tx},${ty}`);
        if (!data) return 0;

        const subX = Math.floor((worldX % this.tileSize) / (this.tileSize / this.subDiv));
        const subY = Math.floor((worldY % this.tileSize) / (this.tileSize / this.subDiv));
        return data[subY * this.subDiv + subX] || 0;
    }

    public getMaterialAt(worldX: number, worldY: number): MaterialType {
        const tx = Math.floor(worldX / this.tileSize);
        const ty = Math.floor(worldY / this.tileSize);
        const data = this.materialData.get(`${tx},${ty}`);
        if (!data) return MaterialType.NONE;

        const subX = Math.floor((worldX % this.tileSize) / (this.tileSize / this.subDiv));
        const subY = Math.floor((worldY % this.tileSize) / (this.tileSize / this.subDiv));
        return data[subY * this.subDiv + subX];
    }

    public hasTileData(tx: number, ty: number): boolean {
        const key = `${tx},${ty}`;
        // Only consider it 'damaged' if it has scorch marks or heat - 
        // this ensures Section 3 of rebuildMesh picks it up.
        return this.hpData.has(key) && (this.scorchData.has(key) || this.heatData.has(key) || this.fireData.has(key));
    }

    public getTileHP(tx: number, ty: number): Float32Array | null {
        return this.hpData.get(`${tx},${ty}`) || null;
    }

    public getTileHeat(tx: number, ty: number): Float32Array | null {
        return this.heatData.get(`${tx},${ty}`) || null;
    }

    public getTileScorch(tx: number, ty: number): Uint8Array | null {
        return this.scorchData.get(`${tx},${ty}`) || null;
    }

    // --- NETWORK SYNC METHODS ---

    /**
     * Returns a compressed snapshot of active tiles for network sync.
     * Only sends tiles that have active Heat, Fire, or Scorch marks.
     */
    public getDeltaState(): any[] {
        const delta: any[] = [];
        
        // Add active tiles
        this.activeTiles.forEach(key => {
            const h = this.heatData.get(key);
            const f = this.fireData.get(key);
            const s = this.scorchData.get(key);
            const m = this.moltenData.get(key);
            
            if (h || f || s || m) {
                const dObj: any = { k: key };
                if (h) dObj.h = this.compressFloatArray(h);
                if (f) dObj.f = this.compressFloatArray(f);
                if (m) dObj.m = this.compressFloatArray(m);
                if (s) dObj.s = Array.from(s); 
                delta.push(dObj);
            }
        });

        // Add recently deactivated tiles
        this.recentlyDeactivated.forEach(key => {
            delta.push({ k: key, c: 1 }); // c:1 means Clear/Deactivated
        });
        this.recentlyDeactivated.clear();

        return delta;
    }

    public applyDeltaState(delta: any[]): void {
        // If Host sends a "reset" or we want to track inactive tiles:
        // For now, Host sends a list of keys that are active.
        // We might want to remove local tiles that the host didn't send if they are "old".
        
        delta.forEach(d => {
            const key = d.k;
            const [tx, ty] = key.split(',').map(Number);
            
            // Special "Clear" command from Host
            if (d.c === 1) {
                this.forceClear(key);
                return;
            }

            this.activeTiles.add(key);

            if (d.h !== undefined) {
                let h = this.heatData.get(key);
                if (!h) { h = new Float32Array(this.subDiv * this.subDiv); this.heatData.set(key, h); }
                this.decompressFloatArray(d.h, h);
            }
            if (d.f !== undefined) {
                let f = this.fireData.get(key);
                if (!f) { f = new Float32Array(this.subDiv * this.subDiv); this.fireData.set(key, f); }
                this.decompressFloatArray(d.f, f);
            }
            if (d.m !== undefined) {
                let m = this.moltenData.get(key);
                if (!m) { m = new Float32Array(this.subDiv * this.subDiv); this.moltenData.set(key, m); }
                this.decompressFloatArray(d.m, m);
            }
            if (d.s) {
                let s = this.scorchData.get(key);
                if (!s) { 
                    s = new Uint8Array(this.subDiv * this.subDiv); 
                    this.scorchData.set(key, s); 
                }
                const serverS = d.s;
                let changed = false;
                for(let i=0; i<serverS.length; i++) {
                    if (s[i] !== serverS[i]) {
                        s[i] = serverS[i];
                        changed = true;
                    }
                }
                if (changed && this.worldRef) {
                    this.worldRef.notifyTileChange(tx, ty);
                }
            }
        });
    }

    private forceClear(key: string): void {
        this.heatData.delete(key);
        this.fireData.delete(key);
        this.moltenData.delete(key);
        this.activeTiles.delete(key);
        const [tx, ty] = key.split(',').map(Number);
        if (this.worldRef) this.worldRef.notifyTileChange(tx, ty);
    }

    private compressFloatArray(arr: Float32Array): number[] {
        const res: number[] = [];
        let hasNonZero = false;
        for(let i=0; i<arr.length; i++) {
            const v = Math.round(arr[i] * 100) / 100;
            res.push(v);
            if (v > 0.01) hasNonZero = true; // Use threshold
        }
        return hasNonZero ? res : [];
    }

    private decompressFloatArray(source: number[], target: Float32Array): void {
        if (source.length === 0) {
            target.fill(0);
            return;
        }
        for(let i=0; i<Math.min(source.length, target.length); i++) {
            target[i] = source[i];
        }
    }
}

    

        

    