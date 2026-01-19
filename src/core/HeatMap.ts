/// <reference types="vite/client" />
import { SoundManager } from './SoundManager';
import { ConfigManager } from '../config/MasterConfig';
import { FloorDecalManager } from './FloorDecalManager';
import { WeatherManager } from './WeatherManager';

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

export interface TileSummary {
    burningCount: number;
    maxHeat: number;
    maxMolten: number;
    avgHeat: number;
}

export class HeatMap {
    private heatData: Map<string, Float32Array> = new Map();
    private activeTiles: Set<string> = new Set();
    private tileSummaries: Map<string, TileSummary> = new Map();
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

    private simInterval: number = 1; // Uniform update every frame
    private frameCount: number = 0;
    private fireAsset: HTMLImageElement | null = null;
    private worldRef: any = null;
    private widthTiles: number = 0;
    private heightTiles: number = 0;
    private recentlyDeactivated: Set<string> = new Set();
    private scratchCanvas: HTMLCanvasElement | null = null;
    private scratchCtx: CanvasRenderingContext2D | null = null;
    private scratchImageData: ImageData | null = null;
    private scratchUint32: Uint32Array | null = null;

    // Zero-allocation scratch buffers
    private scratchHeat: Float32Array;
    private scratchFire: Float32Array;
    private scratchMolten: Float32Array;

    private static heatColorLUT: Uint32Array = new Uint32Array(256);
    private static moltenColorLUT: Uint32Array = new Uint32Array(256);
    private static lutsInitialized: boolean = false;

    constructor(private tileSize: number) {
        this.lastSimTime = performance.now();
        this.scratchHeat = new Float32Array(100); // 10x10
        this.scratchFire = new Float32Array(100);
        this.scratchMolten = new Float32Array(100);
        
        if (!HeatMap.lutsInitialized) {
            this.initLUTs();
        }
    }

    private initLUTs() {
        for (let i = 0; i < 256; i++) {
            const intensity = i / 255;
            const components = HeatMap.getHeatColorComponents(intensity);
            const alpha = Math.floor((intensity < 0.8 ? (0.4 + intensity * 0.6) : 1.0) * 255);
            // ImageData is RGBA, so Uint32 in Little Endian is 0xAABBGGRR
            HeatMap.heatColorLUT[i] = (alpha << 24) | (components.b << 16) | (components.g << 8) | components.r;
            
            // Molten: Gold/Orange
            const mAlpha = Math.floor(Math.min(1.0, intensity) * 255);
            HeatMap.moltenColorLUT[i] = (mAlpha << 24) | (0 << 16) | (200 << 8) | 255;
        }
        HeatMap.lutsInitialized = true;
    }

    public getTileSummary(key: string): TileSummary | undefined {
        return this.tileSummaries.get(key);
    }

    public getTileSize(): number {
        return this.tileSize;
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
            { x, y },
            { x: x - radius, y },
            { x: x + radius, y },
            { x, y: y - radius },
            { x, y: y + radius }
        ];

        for (const p of points) {
            if (this.isSubTileBurning(p.x, p.y)) return true;
        }
        return false;
    }

    public getMaxIntensityArea(x: number, y: number, radius: number): number {
        const points = [
            { x, y },
            { x: x - radius, y },
            { x: x + radius, y },
            { x, y: y - radius },
            { x, y: y + radius }
        ];

        let max = 0;
        for (const p of points) {
            max = Math.max(max, this.getIntensityAt(p.x, p.y));
        }
        return max;
    }

    public getMaxMoltenArea(x: number, y: number, radius: number): number {
        const points = [
            { x, y },
            { x: x - radius, y },
            { x: x + radius, y },
            { x, y: y - radius },
            { x, y: y + radius }
        ];

        let max = 0;
        for (const p of points) {
            max = Math.max(max, this.getMoltenAt(p.x, p.y));
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

    public getFireClusters(gridSize: number): { x: number, y: number, intensity: number, color: string }[] {
        const clusters: Map<string, { x: number, y: number, intensity: number, count: number, r: number, g: number, b: number }> = new Map();
        const fireColor = { r: 255, g: 102, b: 0 }; // Default fire orange

        this.activeTiles.forEach(key => {
            const summary = this.tileSummaries.get(key);
            if (!summary) return;

            // Only cluster tiles with significant heat, fire or molten metal
            if (summary.burningCount === 0 && summary.maxHeat < 0.3 && summary.maxMolten < 0.1) return;

            const [tx, ty] = key.split(',').map(Number);
            const worldX = tx * this.tileSize;
            const worldY = ty * this.tileSize;

            // Use the center of the tile for the cluster point to avoid sub-tile iteration
            const px = worldX + this.tileSize / 2;
            const py = worldY + this.tileSize / 2;

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

            const inst = Math.max(summary.burningCount / 100, (summary.maxHeat - 0.2) * 1.5, summary.maxMolten);
            cluster.intensity += inst;
            cluster.count++;

            // Color mix based on dominant factor
            if (summary.burningCount > 0) {
                cluster.r += fireColor.r; cluster.g += fireColor.g; cluster.b += fireColor.b;
            } else if (summary.maxMolten > 0.1) {
                cluster.r += 255; cluster.g += 170; cluster.b += 0; 
            } else {
                const hc = HeatMap.getHeatColorComponents(summary.maxHeat);
                cluster.r += hc.r; cluster.g += hc.g; cluster.b += hc.b;
            }
        });

        return Array.from(clusters.values()).map(c => ({
            x: c.x / c.count,
            y: c.y / c.count,
            intensity: c.intensity / c.count,
            color: `rgb(${Math.floor(c.r / c.count)}, ${Math.floor(c.g / c.count)}, ${Math.floor(c.b / c.count)})`
        }));
    }

    public getHeatColor(intensity: number): string {
        const { r, g, b } = HeatMap.getHeatColorComponents(intensity);
        return `rgba(${r}, ${g}, ${b}, ${0.4 + intensity * 0.6})`;
    }

    public static getHeatColorComponents(intensity: number): { r: number, g: number, b: number } {
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
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < radius) {
                const effect = (1 - dist / radius) * amount;
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
        if (fData[idx] === 0) {
            fData[idx] = 0.1;
        }
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
            const dist = Math.sqrt(dx * dx + dy * dy);

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
            const dist = Math.sqrt(dx * dx + dy * dy);

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
        
        const effectiveDT = dt; // Continuous update
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
            const summary = this.tileSummaries.get(key);
            if (data && summary) {
                WeatherManager.getInstance().removeSnowFromHeat(tx, ty, data, this.tileSize, summary.maxHeat);
            }

            const fData = this.fireData.get(key);
            const mlData = this.moltenData.get(key);
            const mData = this.materialData.get(key);
            const hData = this.hpData.get(key);
            const wData = this.whiteHeatTime.get(key) || new Float32Array(this.subDiv * this.subDiv);
            if (!this.whiteHeatTime.has(key)) this.whiteHeatTime.set(key, wData);

            let hasActivity = false;
            let burningSubTiles = 0;
            let maxHeat = 0;
            let sumHeat = 0;
            let maxMolten = 0;

            // Zero-allocation scratch preparation
            if (data) this.scratchHeat.set(data); else this.scratchHeat.fill(0);
            if (fData) this.scratchFire.set(fData); else this.scratchFire.fill(0);
            if (mlData) this.scratchMolten.set(mlData); else this.scratchMolten.fill(0);

            for (let y = 0; y < this.subDiv; y++) {
                for (let x = 0; x < this.subDiv; x++) {
                    const idx = y * this.subDiv + x;
                    const isDestroyed = hData && hData[idx] <= 0;
                    const material = mData ? mData[idx] : MaterialType.NONE;

                    // --- HEAT LOGIC ---
                    const val = this.scratchHeat[idx];
                    if (val > 0) {
                        let sum = val;
                        let count = 1;
                        const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                        const isHot = val > 0.1;

                        for (const [nx, ny] of neighbors) {
                            let nSx = x + nx;
                            let nSy = y + ny;

                            if (nSx >= 0 && nSx < this.subDiv && nSy >= 0 && nSy < this.subDiv) {
                                sum += data![nSy * this.subDiv + nSx];
                                count++;
                                continue;
                            }

                            const offsetTx = (nSx < 0 ? -1 : (nSx >= this.subDiv ? 1 : 0));
                            const offsetTy = (nSy < 0 ? -1 : (nSy >= this.subDiv ? 1 : 0));
                            const nTx = tx + offsetTx;
                            const nTy = ty + offsetTy;

                            if (nTx <= 0 || nTx >= this.widthTiles - 1 || nTy <= 0 || nTy >= this.heightTiles - 1) continue;

                            const nKey = `${nTx},${nTy}`;
                            let nd = this.heatData.get(nKey);

                            if (isHot && !nd && !this.activeTiles.has(nKey)) {
                                nd = new Float32Array(this.subDiv * this.subDiv);
                                this.heatData.set(nKey, nd);
                                this.activeTiles.add(nKey);
                            }

                            if (nd) {
                                const wrappedSx = (nSx + this.subDiv) % this.subDiv;
                                const wrappedSy = (nSy + this.subDiv) % this.subDiv;
                                sum += nd[wrappedSy * this.subDiv + wrappedSx];
                                count++;
                            }
                        }
                        const avg = sum / count;
                        this.scratchHeat[idx] = val + (avg - val) * this.spreadRate;
                        this.scratchHeat[idx] = Math.max(0, this.scratchHeat[idx] - this.decayRate * effectiveDT);
                        
                        const finalHeat = this.scratchHeat[idx];
                        if (finalHeat > 0.01) {
                            hasActivity = true;
                            if (finalHeat > maxHeat) maxHeat = finalHeat;
                            sumHeat += finalHeat;
                        }

                        if (finalHeat > 0.95 && !isDestroyed) {
                            wData[idx] += effectiveDT;
                            const mat = material as MaterialType;
                            if (wData[idx] >= MATERIAL_PROPS[mat].vaporizeTime) {
                                if (hData) hData[idx] = 0;
                                if (this.worldRef) {
                                    this.worldRef.markMeshDirty();
                                    this.worldRef.notifyTileChange(tx, ty);
                                    this.worldRef.checkTileDestruction(tx, ty);
                                }
                                if (mat === MaterialType.METAL) {
                                    this.scratchMolten[idx] = 1.0;
                                    hasActivity = true;
                                }
                                this.scratchHeat[idx] = 0.5;
                            }
                        } else {
                            wData[idx] = Math.max(0, wData[idx] - effectiveDT);
                        }
                    }

                    // --- METAL MELTING ---
                    if (material === MaterialType.METAL && this.scratchHeat[idx] > 0.5 && !isDestroyed) {
                        const leakAmount = (this.scratchHeat[idx] - 0.4) * 0.8 * effectiveDT;
                        const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]];

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

                            if (!nhData || nhData[nIdx] <= 0) {
                                let nmData = this.moltenData.get(nKey);
                                if (!nmData) {
                                    nmData = new Float32Array(this.subDiv * this.subDiv);
                                    this.moltenData.set(nKey, nmData);
                                    this.activeTiles.add(nKey);
                                }
                                nmData[nIdx] = Math.min(2.0, nmData[nIdx] + leakAmount);
                                hasActivity = true;
                            }
                        }
                    }

                    // --- MOLTEN LOGIC ---
                    const mVal = this.scratchMolten[idx];
                    if (mVal > 0) {
                        if (mVal > maxMolten) maxMolten = mVal;
                        if (isDestroyed) {
                            hasActivity = true;
                            const pressure = mVal + (this.scratchHeat[idx] * 0.5);
                            if (pressure > 0.15) {
                                const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]];
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

                                    if (!nhData || nhData[nIdx] <= 0) {
                                        let n_nmData = this.moltenData.get(nKey);
                                        if (!n_nmData) {
                                            n_nmData = new Float32Array(this.subDiv * this.subDiv);
                                            this.moltenData.set(nKey, n_nmData);
                                            this.activeTiles.add(nKey);
                                        }
                                        const flowRate = 2.0 * (1 + this.scratchHeat[idx]);
                                        const spreadAmount = (pressure - 0.05) * flowRate * effectiveDT;
                                        if (spreadAmount > 0.001) {
                                            n_nmData[nIdx] = Math.min(2.0, n_nmData[nIdx] + spreadAmount);
                                            this.scratchMolten[idx] -= spreadAmount * 0.9;
                                        }
                                    }
                                }
                            }

                            if (this.scratchHeat[idx] < 0.2) {
                                const worldX = tx * this.tileSize + (x + 0.5) * (this.tileSize / this.subDiv);
                                const worldY = ty * this.tileSize + (y + 0.5) * (this.tileSize / this.subDiv);
                                FloorDecalManager.getInstance().addCooledMetalMark(worldX, worldY, (this.tileSize / this.subDiv) * (0.5 + this.scratchMolten[idx] * 2.0));
                                this.scratchMolten[idx] = 0;
                            }
                        }
                    }

                    // --- FIRE LOGIC (Throttled to 15Hz for performance and speed control) ---
                    if (this.scratchFire[idx] > 0 && material === MaterialType.WOOD) {
                        hasActivity = true;
                        burningSubTiles++;

                        if (this.frameCount % 4 === 0) {
                            const speedMult = ConfigManager.getInstance().get<number>('Fire', 'fireSpreadSpeed') || 0.4;
                            const fireInc = effectiveDT * 0.5 * speedMult;
                            this.scratchFire[idx] += fireInc;
                            this.scratchHeat[idx] = Math.min(1.0, this.scratchHeat[idx] + this.scratchFire[idx] * 0.2);

                            // Slower wood destruction
                            if (hData) hData[idx] -= effectiveDT * 2.5 * speedMult;

                            if (this.scratchFire[idx] > 0.3) {
                                const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                                for (const [nx, ny] of neighbors) {
                                    let nSx = x + nx;
                                    let nSy = y + ny;
                                    if (nSx >= 0 && nSx < this.subDiv && nSy >= 0 && nSy < this.subDiv) {
                                        const nIdx = nSy * this.subDiv + nSx;
                                        if (this.scratchFire[nIdx] === 0 && hData && hData[nIdx] > 0) {
                                            if (Math.random() < 0.2 * speedMult) {
                                                this.scratchFire[nIdx] = 0.05;
                                            }
                                        }
                                    } else {
                                        const nTx = tx + (nSx < 0 ? -1 : (nSx >= this.subDiv ? 1 : 0));
                                        const nTy = ty + (nSy < 0 ? -1 : (nSy >= this.subDiv ? 1 : 0));
                                        if (nTx <= 0 || nTx >= this.widthTiles - 1 || nTy <= 0 || nTy >= this.heightTiles - 1) continue;
                                        const nKey = `${nTx},${nTy}`;
                                        const wrappedSx = (nSx + this.subDiv) % this.subDiv;
                                        const wrappedSy = (nSy + this.subDiv) % this.subDiv;
                                        const nIdx = wrappedSy * this.subDiv + wrappedSx;
                                        const nmData = this.materialData.get(nKey);
                                        if (nmData && MATERIAL_PROPS[nmData[nIdx] as MaterialType].flammable) {
                                            if (Math.random() < 0.05 * speedMult) {
                                                this.ignite(nTx, nTy, nIdx);
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        if (hData && hData[idx] <= 0) {
                            if (this.worldRef) {
                                this.worldRef.markMeshDirty();
                                this.worldRef.notifyTileChange(tx, ty);
                                this.worldRef.checkTileDestruction(tx, ty);
                            }
                            this.scratchFire[idx] = 0;
                            this.scratchHeat[idx] = 0.2;
                        }
                    }
                }
            }

            // Update summary
            this.tileSummaries.set(key, {
                burningCount: burningSubTiles,
                maxHeat: maxHeat,
                maxMolten: maxMolten,
                avgHeat: sumHeat / (this.subDiv * this.subDiv)
            });

            if (burningSubTiles > 0) {
                const worldX = tx * this.tileSize + this.tileSize / 2;
                const worldY = ty * this.tileSize + this.tileSize / 2;
                soundMgr.updateAreaSound('fire', worldX, worldY, burningSubTiles);
            }

            // Save scratch buffers back to logical state
            if (data) data.set(this.scratchHeat);
            if (fData) fData.set(this.scratchFire);
            if (mlData) mlData.set(this.scratchMolten);

            if (!hasActivity) {
                // Check if logic data has actually settled before deactivating
                let hasSettled = true;
                if (data) { for (let i = 0; i < data.length; i++) if (data[i] > 0.01) { hasSettled = false; break; } }
                if (hasSettled && fData) { for (let i = 0; i < fData.length; i++) if (fData[i] > 0.01) { hasSettled = false; break; } }
                if (hasSettled && mlData) { for (let i = 0; i < mlData.length; i++) if (mlData[i] > 0.01) { hasSettled = false; break; } }

                if (hasSettled) {
                    toRemove.push(key);
                    const mm = (window as any).MultiplayerManager?.getInstance();
                    if (!mm || mm.isHost) {
                        this.recentlyDeactivated.add(key);
                    }
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
            this.scratchImageData = this.scratchCtx.createImageData(this.subDiv, this.subDiv);
            this.scratchUint32 = new Uint32Array(this.scratchImageData.data.buffer);
        }

        const sCtx = this.scratchCtx!;
        const sCanv = this.scratchCanvas!;
        const sData = this.scratchImageData!;
        const sU32 = this.scratchUint32!;

        this.activeTiles.forEach(key => {
            const [tx, ty] = key.split(',').map(Number);
            const worldX = tx * this.tileSize;
            const worldY = ty * this.tileSize;

            if (worldX + this.tileSize < cameraX || worldX > cameraX + viewW ||
                worldY + this.tileSize < cameraY || worldY > cameraY + viewH) return;

            const heatData = this.heatData.get(key);
            const fireData = this.fireData.get(key);
            const hData = this.hpData.get(key);
            const moltenData = this.moltenData.get(key);

            if (!heatData && !fireData && !moltenData) return;

            // 1. Render Blended Heat Glow using LUT
            if (heatData) {
                let hasSignificantHeat = false;
                sU32.fill(0);

                for (let i = 0; i < heatData.length; i++) {
                    const h = heatData[i];
                    // Render ground heat glow only if wall is destroyed or not present
                    if (h > 0.4 && (!hData || hData[i] <= 0)) {
                        hasSignificantHeat = true;
                        const lutIdx = Math.floor(h * 255);
                        sU32[i] = HeatMap.heatColorLUT[lutIdx];
                    }
                }

                if (hasSignificantHeat) {
                    sCtx.putImageData(sData, 0, 0);
                    ctx.save();
                    ctx.imageSmoothingEnabled = true;
                    ctx.drawImage(sCanv, worldX, worldY, this.tileSize, this.tileSize);
                    ctx.restore();
                }
            }

            // 2. Render Molten Metal Puddles using LUT
            if (moltenData) {
                let hasMolten = false;
                sU32.fill(0);

                for (let i = 0; i < moltenData.length; i++) {
                    const m = moltenData[i];
                    if (m > 0.05) {
                        hasMolten = true;
                        const lutIdx = Math.floor(Math.min(1.0, m) * 255);
                        sU32[i] = HeatMap.moltenColorLUT[lutIdx];
                    }
                }

                if (hasMolten) {
                    sCtx.putImageData(sData, 0, 0);
                    ctx.save();
                    ctx.imageSmoothingEnabled = true;
                    
                    // Optimization: Use additive blending for glow instead of shadowBlur
                    ctx.globalCompositeOperation = 'screen';
                    ctx.globalAlpha = 0.5;
                    // Layer 1: Outer Glow (Scaled up)
                    ctx.drawImage(sCanv, worldX - 4, worldY - 4, this.tileSize + 8, this.tileSize + 8);
                    
                    // Layer 2: Core
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.globalAlpha = 0.95;
                    ctx.drawImage(sCanv, worldX, worldY, this.tileSize, this.tileSize);

                    ctx.restore();
                }
            }

            // 3. Render Fire (Quadrant-Based Batching)
            if (fireData) {
                const summary = this.tileSummaries.get(key);
                if (summary && summary.burningCount > 0) {
                    const qSize = this.subDiv / 2; // 5x5 quadrants
                    const quadWorldSize = this.tileSize / 2;

                    for (let qy = 0; qy < 2; qy++) {
                        for (let qx = 0; qx < 2; qx++) {
                            // Check if quadrant has fire
                            let quadIntensity = 0;
                            let burningInQuad = 0;
                            
                            for (let sy = qy * qSize; sy < (qy + 1) * qSize; sy++) {
                                for (let sx = qx * qSize; sx < (qx + 1) * qSize; sx++) {
                                    const fIdx = sy * this.subDiv + sx;
                                    if (fireData[fIdx] > 0.05 && hData && hData[fIdx] > 0) {
                                        quadIntensity += fireData[fIdx];
                                        burningInQuad++;
                                    }
                                }
                            }

                            if (burningInQuad > 0) {
                                const avgIntensity = quadIntensity / burningInQuad;
                                const rx = worldX + qx * quadWorldSize + quadWorldSize / 2;
                                const ry = worldY + qy * quadWorldSize + quadWorldSize / 2;

                                if (this.fireAsset && this.fireAsset.complete && this.fireAsset.naturalWidth > 0) {
                                    const frameCount = 8;
                                    const idHash = (tx * 7 + ty * 13 + qx * 3 + qy * 17);
                                    const frame = Math.floor((time * 15 + idHash) % frameCount);
                                    const fw = this.fireAsset.width / frameCount;
                                    const fh = this.fireAsset.height;
                                    const fx = frame * fw;
                                    
                                    // Scale sprite based on quadrant intensity
                                    const displaySize = quadWorldSize * (1.2 + avgIntensity * 0.8);
                                    ctx.drawImage(this.fireAsset, fx, 0, fw, fh, rx - displaySize / 2, ry - displaySize * 0.8, displaySize, displaySize);
                                } else {
                                    const pulse = 0.6 + Math.sin(time * 30 + qx + qy) * 0.4;
                                    ctx.fillStyle = `rgba(255, 100, 0, ${avgIntensity * pulse * 0.6})`;
                                    ctx.fillRect(rx - quadWorldSize / 2, ry - quadWorldSize / 2, quadWorldSize, quadWorldSize);
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    public getAverageIntensity(tx: number, ty: number): number {
        const data = this.heatData.get(`${tx},${ty}`);
        if (!data) return 0;
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        return sum / data.length;
    }

    public isTileIgnited(tx: number, ty: number): boolean {
        const fData = this.fireData.get(`${tx},${ty}`);
        if (!fData) return false;
        for (let i = 0; i < fData.length; i++) {
            if (fData[i] > 0.1) return true;
        }
        return false;
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
        const hData = this.hpData.get(key);
        if (!hData) return false;

        // If any sub-tile is destroyed, we definitely have 'structural' damage
        for (let i = 0; i < hData.length; i++) {
            if (hData[i] <= 0) return true;
        }

        // Otherwise, check for 'surface' effects (scorch, heat, fire)
        return (this.scorchData.has(key) || this.heatData.has(key) || this.fireData.has(key));
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
                if (!h) { 
                    h = new Float32Array(this.subDiv * this.subDiv); 
                    this.heatData.set(key, h); 
                }
                this.decompressFloatArray(d.h, h);
            }
            if (d.f !== undefined) {
                let f = this.fireData.get(key);
                if (!f) { 
                    f = new Float32Array(this.subDiv * this.subDiv); 
                    this.fireData.set(key, f); 
                }
                this.decompressFloatArray(d.f, f);
            }
            if (d.m !== undefined) {
                let m = this.moltenData.get(key);
                if (!m) { 
                    m = new Float32Array(this.subDiv * this.subDiv); 
                    this.moltenData.set(key, m); 
                }
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
                for (let i = 0; i < serverS.length; i++) {
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
        for (let i = 0; i < arr.length; i++) {
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
        for (let i = 0; i < Math.min(source.length, target.length); i++) {
            target[i] = source[i];
        }
    }
}





