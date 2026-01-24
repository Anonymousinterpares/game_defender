import { MaterialType, MATERIAL_PROPS, TileSummary, HEATMAP_SETTINGS } from './heatmap/HeatMapTypes';
import { HeatMapState } from './heatmap/HeatMapState';
import { HeatMapSimulator } from './heatmap/HeatMapSimulator';
import { HeatMapRenderer } from './heatmap/HeatMapRenderer';

export type { MaterialProperties, TileSummary } from './heatmap/HeatMapTypes';
export { MaterialType, MATERIAL_PROPS } from './heatmap/HeatMapTypes';

export class HeatMap {
    private state: HeatMapState;
    private simulator: HeatMapSimulator;
    private renderer: HeatMapRenderer;

    private worldRef: any = null;
    private widthTiles: number = 0;
    private heightTiles: number = 0;

    public onHeatAdded?: (x: number, y: number, amount: number, radius: number) => void;
    public onIgnite?: (x: number, y: number, radius: number) => void;

    constructor(private tileSize: number) {
        this.state = new HeatMapState();
        this.simulator = new HeatMapSimulator();
        (this.simulator as any).facade = this;
        this.renderer = new HeatMapRenderer();
    }

    public get activeTiles(): Set<string> {
        return this.state.activeTiles;
    }

    public clear(): void {
        this.state.clear();
    }

    // --- Public API Coordination ---

    public setWorldRef(world: any): void {
        this.worldRef = world;
        this.widthTiles = world.getWidth();
        this.heightTiles = world.getHeight();
    }

    public getTileSize(): number {
        return this.tileSize;
    }

    public getTileSummary(key: string): TileSummary | undefined {
        return this.state.tileSummaries.get(key);
    }

    public isSubTileBurning(worldX: number, worldY: number): boolean {
        const tx = Math.floor(worldX / this.tileSize);
        const ty = Math.floor(worldY / this.tileSize);
        const fData = this.state.fireData.get(`${tx},${ty}`);
        if (!fData) return false;

        const subX = Math.floor((worldX % this.tileSize) / (this.tileSize / this.state.subDiv));
        const subY = Math.floor((worldY % this.tileSize) / (this.tileSize / this.state.subDiv));
        const idx = subY * this.state.subDiv + subX;
        return fData[idx] > 0.1;
    }

    public checkFireArea(x: number, y: number, radius: number): boolean {
        const points = [{ x, y }, { x: x - radius, y }, { x: x + radius, y }, { x, y: y - radius }, { x, y: y + radius }];
        for (const p of points) {
            if (this.isSubTileBurning(p.x, p.y)) return true;
        }
        return false;
    }

    public getIntensityAt(worldX: number, worldY: number): number {
        const tx = Math.floor(worldX / this.tileSize);
        const ty = Math.floor(worldY / this.tileSize);
        const data = this.state.heatData.get(`${tx},${ty}`);
        if (!data) return 0;

        const subX = Math.floor((worldX % this.tileSize) / (this.tileSize / this.state.subDiv));
        const subY = Math.floor((worldY % this.tileSize) / (this.tileSize / this.state.subDiv));
        return data[subY * this.state.subDiv + subX] || 0;
    }

    public getMoltenAt(worldX: number, worldY: number): number {
        const tx = Math.floor(worldX / this.tileSize);
        const ty = Math.floor(worldY / this.tileSize);
        const data = this.state.moltenData.get(`${tx},${ty}`);
        if (!data) return 0;

        const subX = Math.floor((worldX % this.tileSize) / (this.tileSize / this.state.subDiv));
        const subY = Math.floor((worldY % this.tileSize) / (this.tileSize / this.state.subDiv));
        return data[subY * this.state.subDiv + subX] || 0;
    }

    public getMaterialAt(worldX: number, worldY: number): MaterialType {
        const tx = Math.floor(worldX / this.tileSize);
        const ty = Math.floor(worldY / this.tileSize);
        const data = this.state.materialData.get(`${tx},${ty}`);
        if (!data) return MaterialType.NONE;

        const subX = Math.floor((worldX % this.tileSize) / (this.tileSize / this.state.subDiv));
        const subY = Math.floor((worldY % this.tileSize) / (this.tileSize / this.state.subDiv));
        return data[subY * this.state.subDiv + subX];
    }

    public getMaxIntensityArea(x: number, y: number, radius: number): number {
        const points = [{ x, y }, { x: x - radius, y }, { x: x + radius, y }, { x, y: y - radius }, { x, y: y + radius }];
        let max = 0;
        for (const p of points) max = Math.max(max, this.getIntensityAt(p.x, p.y));
        return max;
    }

    public getMaxMoltenArea(x: number, y: number, radius: number): number {
        const points = [{ x, y }, { x: x - radius, y }, { x: x + radius, y }, { x, y: y - radius }, { x, y: y + radius }];
        let max = 0;
        for (const p of points) max = Math.max(max, this.getMoltenAt(p.x, p.y));
        return max;
    }

    public setMaterial(tx: number, ty: number, material: MaterialType): void {
        const key = `${tx},${ty}`;
        const subDiv = this.state.subDiv;
        this.state.materialData.set(key, new Uint8Array(subDiv * subDiv).fill(material));
        const hp = MATERIAL_PROPS[material].hp;
        this.state.hpData.set(key, new Float32Array(subDiv * subDiv).fill(hp));
    }

    public isSubTileDestroyed(worldX: number, worldY: number): boolean {
        const tx = Math.floor(worldX / this.tileSize);
        const ty = Math.floor(worldY / this.tileSize);
        const hp = this.state.hpData.get(`${tx},${ty}`);
        if (!hp) return false;

        const subX = Math.floor((worldX % this.tileSize) / (this.tileSize / this.state.subDiv));
        const subY = Math.floor((worldY % this.tileSize) / (this.tileSize / this.state.subDiv));
        return hp[subY * this.state.subDiv + subX] <= 0;
    }

    public isTileMostlyDestroyed(tx: number, ty: number): boolean {
        const hData = this.state.hpData.get(`${tx},${ty}`);
        if (!hData) return false;
        let destroyedCount = 0;
        for (let i = 0; i < hData.length; i++) if (hData[i] <= 0) destroyedCount++;
        return destroyedCount > (hData.length * 0.8);
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
        if (this.onHeatAdded) this.onHeatAdded(worldX, worldY, amount, radius);
    }

    private applyHeatToTile(tx: number, ty: number, hitX: number, hitY: number, amount: number, radius: number): void {
        if (tx <= 0 || tx >= this.widthTiles - 1 || ty <= 0 || ty >= this.heightTiles - 1) return;

        const key = `${tx},${ty}`;
        let data = this.state.heatData.get(key);
        if (!data) {
            data = new Float32Array(this.state.subDiv * this.state.subDiv);
            this.state.heatData.set(key, data);
        }
        this.state.activeTiles.add(key);

        const tileWorldX = tx * this.tileSize;
        const tileWorldY = ty * this.tileSize;
        const subSize = this.tileSize / this.state.subDiv;
        const mData = this.state.materialData.get(key);
        const hData = this.state.hpData.get(key);

        for (let i = 0; i < data.length; i++) {
            if (hData && hData[i] <= 0) continue;

            const subX = i % this.state.subDiv;
            const subY = Math.floor(i / this.state.subDiv);
            const dx = (tileWorldX + (subX + 0.5) * subSize) - hitX;
            const dy = (tileWorldY + (subY + 0.5) * subSize) - hitY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < radius) {
                data[i] = Math.min(1.0, data[i] + (1 - dist / radius) * amount);
                this.simulator.applyScorch(this.state, tx, ty, i, this.worldRef);
                if (data[i] > 0.6 && mData && MATERIAL_PROPS[mData[i] as MaterialType].flammable) {
                    this.simulator.ignite(this.state, tx, ty, i, this.tileSize);
                }
            }
        }
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
        if (this.onIgnite) this.onIgnite(worldX, worldY, radius);
    }

    private igniteInTile(tx: number, ty: number, hitX: number, hitY: number, radius: number): void {
        const key = `${tx},${ty}`;
        const mData = this.state.materialData.get(key);
        const hData = this.state.hpData.get(key);
        if (!mData || !hData) return;

        const tileWorldX = tx * this.tileSize;
        const tileWorldY = ty * this.tileSize;
        const subSize = this.tileSize / this.state.subDiv;

        for (let i = 0; i < mData.length; i++) {
            if (hData[i] <= 0 || !MATERIAL_PROPS[mData[i] as MaterialType].flammable) continue;

            const subX = i % this.state.subDiv;
            const subY = Math.floor(i / this.state.subDiv);
            const dx = (tileWorldX + (subX + 0.5) * subSize) - hitX;
            const dy = (tileWorldY + (subY + 0.5) * subSize) - hitY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < radius && this.isSubTileSurface(tx, ty, i)) {
                this.simulator.ignite(this.state, tx, ty, i, this.tileSize);
                this.simulator.applyScorch(this.state, tx, ty, i, this.worldRef);
            }
        }
    }

    private isSubTileSurface(tx: number, ty: number, subIdx: number): boolean {
        const subDiv = this.state.subDiv;
        const sx = subIdx % subDiv;
        const sy = Math.floor(subIdx / subDiv);
        const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];

        for (const [nx, ny] of neighbors) {
            let nsx = sx + nx;
            let nsy = sy + ny;
            let nKey = `${tx},${ty}`;

            if (nsx < 0 || nsx >= subDiv || nsy < 0 || nsy >= subDiv) {
                const ntx = tx + (nsx < 0 ? -1 : (nsx >= subDiv ? 1 : 0));
                const nty = ty + (nsy < 0 ? -1 : (nsy >= subDiv ? 1 : 0));
                nKey = `${ntx},${nty}`;
                nsx = (nsx + subDiv) % subDiv;
                nsy = (nsy + subDiv) % subDiv;
            }

            const nhData = this.state.hpData.get(nKey);
            if (!nhData || nhData[nsy * subDiv + nsx] <= 0) return true;
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
        const hData = this.state.hpData.get(key);
        const mData = this.state.materialData.get(key);
        if (!hData || !mData) return;

        const tileWorldX = tx * this.tileSize;
        const tileWorldY = ty * this.tileSize;
        const subSize = this.tileSize / this.state.subDiv;

        for (let i = 0; i < hData.length; i++) {
            if (hData[i] <= 0 || mData[i] === MaterialType.INDESTRUCTIBLE) continue;

            const subX = i % this.state.subDiv;
            const subY = Math.floor(i / this.state.subDiv);
            const dx = (tileWorldX + (subX + 0.5) * subSize) - hitX;
            const dy = (tileWorldY + (subY + 0.5) * subSize) - hitY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            let effectiveRadius = radius;
            if (isIrregular) {
                const angle = Math.atan2(dy, dx);
                effectiveRadius += (Math.sin(angle * 5) + Math.cos(angle * 3)) * 5;
            }

            if (dist < effectiveRadius) {
                hData[i] = 0;
                if (this.worldRef) {
                    this.worldRef.markMeshDirty();
                    this.worldRef.notifyTileChange(tx, ty);
                    this.worldRef.checkTileDestruction(tx, ty);
                }
            } else if (dist < effectiveRadius + subSize * 2) {
                this.simulator.applyScorch(this.state, tx, ty, i, this.worldRef);
            }
        }
    }

    public update(dt: number): void {
        this.simulator.update(this.state, dt, this.widthTiles, this.heightTiles, this.tileSize, this.worldRef);
    }

    public render(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, gpuActive: boolean = false): void {
        this.renderer.render(this.state, ctx, cameraX, cameraY, this.tileSize, gpuActive);
    }

    public getHeatColor(intensity: number): string {
        return this.renderer.getHeatColor(intensity);
    }

    public static getHeatColorComponents(intensity: number): { r: number, g: number, b: number } {
        // Kept for backward compatibility, proxies to renderer logic if possible, 
        // or re-implemented if needed without renderer instance.
        if (intensity < 0.4) {
            return { r: Math.floor(100 + 155 * (intensity / 0.4)), g: 0, b: 0 };
        } else if (intensity < 0.8) {
            return { r: 255, g: Math.floor(255 * ((intensity - 0.4) / 0.4)), b: 0 };
        } else {
            return { r: 255, g: 255, b: Math.floor(255 * ((intensity - 0.8) / 0.2)) };
        }
    }

    public getAverageIntensity(tx: number, ty: number): number {
        const data = this.state.heatData.get(`${tx},${ty}`);
        if (!data) return 0;
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        return sum / data.length;
    }

    public isTileIgnited(tx: number, ty: number): boolean {
        const fData = this.state.fireData.get(`${tx},${ty}`);
        if (!fData) return false;
        for (let i = 0; i < fData.length; i++) if (fData[i] > 0.1) return true;
        return false;
    }

    public hasTileData(tx: number, ty: number): boolean {
        const key = `${tx},${ty}`;
        const hData = this.state.hpData.get(key);
        if (!hData) return false;
        for (let i = 0; i < hData.length; i++) if (hData[i] <= 0) return true;
        return (this.state.scorchData.has(key) || this.state.heatData.has(key) || this.state.fireData.has(key));
    }

    public getTileHP(tx: number, ty: number): Float32Array | null {
        return this.state.hpData.get(`${tx},${ty}`) || null;
    }

    public getTileHeat(tx: number, ty: number): Float32Array | null {
        return this.state.heatData.get(`${tx},${ty}`) || null;
    }

    public getTileScorch(tx: number, ty: number): Uint8Array | null {
        return this.state.scorchData.get(`${tx},${ty}`) || null;
    }

    public getFireClusters(gridSize: number): { x: number, y: number, intensity: number, color: string }[] {
        const clusters: Map<string, { x: number, y: number, intensity: number, count: number, r: number, g: number, b: number }> = new Map();
        const fireColor = { r: 255, g: 102, b: 0 };

        this.state.activeTiles.forEach(key => {
            const summary = this.state.tileSummaries.get(key);
            if (!summary || (summary.burningCount === 0 && summary.maxHeat < 0.3 && summary.maxMolten < 0.1)) return;

            const [tx, ty] = key.split(',').map(Number);
            const px = tx * this.tileSize + this.tileSize / 2;
            const py = ty * this.tileSize + this.tileSize / 2;
            const cKey = `${Math.floor(px / gridSize)},${Math.floor(py / gridSize)}`;

            let c = clusters.get(cKey);
            if (!c) { c = { x: 0, y: 0, intensity: 0, count: 0, r: 0, g: 0, b: 0 }; clusters.set(cKey, c); }

            c.x += px; c.y += py;
            c.intensity += Math.max(summary.burningCount / 100, (summary.maxHeat - 0.2) * 1.5, summary.maxMolten);
            c.count++;

            if (summary.burningCount > 0) {
                c.r += fireColor.r; c.g += fireColor.g; c.b += fireColor.b;
            } else if (summary.maxMolten > 0.1) {
                c.r += 255; c.g += 170; c.b += 0;
            } else {
                const hc = HeatMap.getHeatColorComponents(summary.maxHeat);
                c.r += hc.r; c.g += hc.g; c.b += hc.b;
            }
        });

        return Array.from(clusters.values()).map(c => ({
            x: c.x / c.count, y: c.y / c.count, intensity: c.intensity / c.count,
            color: `rgb(${Math.floor(c.r / c.count)}, ${Math.floor(c.g / c.count)}, ${Math.floor(c.b / c.count)})`
        }));
    }

    // --- Network Sync Wrappers ---

    public getDeltaState(): any[] {
        return this.state.getDeltaState();
    }

    public applyDeltaState(delta: any[]): void {
        this.state.applyDeltaState(delta,
            (key) => {
                const [tx, ty] = key.split(',').map(Number);
                if (this.worldRef) this.worldRef.notifyTileChange(tx, ty);
            },
            (key) => {
                const [tx, ty] = key.split(',').map(Number);
                if (this.worldRef) this.worldRef.notifyTileChange(tx, ty);
            }
        );
    }
}
