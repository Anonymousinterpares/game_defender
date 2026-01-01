import { SoundManager } from './SoundManager';
import { ConfigManager } from '../config/MasterConfig';

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
    private whiteHeatTime: Map<string, Float32Array> = new Map(); // how long sub-tile is white-hot
    
    private subDiv: number = 10; // 10x10 sub-elements per tile
    private decayRate: number = 0.05; 
    private spreadRate: number = 0.1; 
    
    private lastSimTime: number = 0;
    private simInterval: number = 3; 
    private frameCount: number = 0;
    private fireAsset: HTMLImageElement | null = null;
    private worldRef: any = null;

    constructor(private tileSize: number) {
        // Pre-load fire spritesheet if configured
        const useSprite = ConfigManager.getInstance().get<boolean>('Fire', 'isFireSpritesheet');
        if (useSprite) {
            this.fireAsset = new Image();
            this.fireAsset.src = '/assets/visuals/fire_spritesheet.svg';
            this.fireAsset.onerror = () => {
                console.warn("Fire spritesheet not found, falling back to procedural.");
                this.fireAsset = null;
            };
        }
    }

    public setWorldRef(world: any): void {
        this.worldRef = world;
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
                    
                    const inst = Math.max(fire, (heat - 0.2) * 1.5);
                    cluster.intensity += inst;
                    cluster.count++;

                    // Color mix
                    if (fire > 0.1) {
                        cluster.r += fireColor.r; cluster.g += fireColor.g; cluster.b += fireColor.b;
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
            if (this.worldRef) this.worldRef.invalidateTileCache(tx, ty);
        }
    }

    private ignite(tx: number, ty: number, idx: number): void {
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
                    this.worldRef.invalidateTileCache(tx, ty);
                }
                // Once destroyed, clear heat/fire
                const heat = this.heatData.get(key);
                if (heat) heat[i] = 0;
                const fire = this.fireData.get(key);
                if (fire) fire[i] = 0;
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
            const data = this.heatData.get(key)!;
            const fData = this.fireData.get(key);
            const mData = this.materialData.get(key);
            const hData = this.hpData.get(key);
            const wData = this.whiteHeatTime.get(key) || new Float32Array(this.subDiv * this.subDiv);
            if (!this.whiteHeatTime.has(key)) this.whiteHeatTime.set(key, wData);

            let hasActivity = false;
            let burningSubTiles = 0;

            const nextData = new Float32Array(data);
            const nextFire = fData ? new Float32Array(fData) : null;

            const [tx, ty] = key.split(',').map(Number);

            for (let y = 0; y < this.subDiv; y++) {
                for (let x = 0; x < this.subDiv; x++) {
                    const idx = y * this.subDiv + x;
                    if (hData && hData[idx] <= 0) continue;

                    // --- HEAT LOGIC ---
                    const val = data[idx];
                    if (val > 0) {
                        let sum = val;
                        let count = 1;
                        const neighbors = [[-1,0], [1,0], [0,-1], [0,1]];
                        for (const [nx, ny] of neighbors) {
                            const nIdx = (y + ny) * this.subDiv + (x + nx);
                            if (x+nx >= 0 && x+nx < this.subDiv && y+ny >= 0 && y+ny < this.subDiv) {
                                sum += data[nIdx];
                                count++;
                            }
                        }
                        const avg = sum / count;
                        nextData[idx] = val + (avg - val) * this.spreadRate;
                        nextData[idx] = Math.max(0, nextData[idx] - this.decayRate * effectiveDT);
                        if (nextData[idx] > 0.01) hasActivity = true;

                        // Vaporization logic
                        if (nextData[idx] > 0.95) {
                            wData[idx] += effectiveDT;
                            const mat = (mData ? mData[idx] : MaterialType.STONE) as MaterialType;
                            if (wData[idx] >= MATERIAL_PROPS[mat].vaporizeTime) {
                                hData![idx] = 0;
                                if (this.worldRef) {
                                    this.worldRef.markMeshDirty();
                                    this.worldRef.invalidateTileCache(tx, ty);
                                }
                                nextData[idx] = 0;
                            }
                        } else {
                            wData[idx] = Math.max(0, wData[idx] - effectiveDT);
                        }
                    }

                    // --- FIRE LOGIC (WOOD ONLY) ---
                    if (nextFire && mData && mData[idx] === MaterialType.WOOD) {
                        if (nextFire[idx] > 0) {
                            hasActivity = true;
                            burningSubTiles++;
                            nextFire[idx] += effectiveDT * 0.5; // Fire grows
                            nextData[idx] = Math.min(1.0, nextData[idx] + nextFire[idx] * 0.2); // Fire heats up tile
                            
                            // Damage block
                            hData![idx] -= effectiveDT * 10; // 1 second to destroy

                            // Spread fire every 100ms per layer (approx)
                            if (nextFire[idx] > 0.3) {
                                const neighbors = [[-1,0], [1,0], [0,-1], [0,1]];
                                for (const [nx, ny] of neighbors) {
                                    const nIdx = (y + ny) * this.subDiv + (x + nx);
                                    if (x+nx >= 0 && x+nx < this.subDiv && y+ny >= 0 && y+ny < this.subDiv) {
                                        if (nextFire[nIdx] === 0 && hData![nIdx] > 0) {
                                            nextFire[nIdx] = 0.05;
                                        }
                                    }
                                }
                            }

                            if (hData![idx] <= 0) {
                                if (this.worldRef) {
                                    this.worldRef.markMeshDirty();
                                    this.worldRef.invalidateTileCache(tx, ty);
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
            
            data.set(nextData);
            if (fData && nextFire) fData.set(nextFire);
            if (!hasActivity) toRemove.push(key);
        });

        toRemove.forEach(k => this.activeTiles.delete(k));
    }

    public render(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number): void {
        const subSize = this.tileSize / this.subDiv;
        const viewW = ctx.canvas.width;
        const viewH = ctx.canvas.height;
        const time = performance.now() * 0.001;

        this.materialData.forEach((mData, key) => {
            const [tx, ty] = key.split(',').map(Number);
            const worldX = tx * this.tileSize;
            const worldY = ty * this.tileSize;

            if (worldX + this.tileSize < cameraX || worldX > cameraX + viewW ||
                worldY + this.tileSize < cameraY || worldY > cameraY + viewH) return;

            const hData = this.hpData.get(key)!;
            const heatData = this.heatData.get(key);
            const fireData = this.fireData.get(key);
            const sData = this.scorchData.get(key);

            for (let i = 0; i < mData.length; i++) {
                if (hData[i] <= 0) continue; // Destroyed

                const sx = i % this.subDiv;
                const sy = Math.floor(i / this.subDiv);
                let rx = worldX + sx * subSize;
                let ry = worldY + sy * subSize;

                const heat = heatData ? heatData[i] : 0;
                const fire = fireData ? fireData[i] : 0;

                // High intensity heat (animated) or fire only
                if (heat > 0.6 || fire > 0) {
                    if (heat > 0.6) {
                        rx += Math.sin(time * 20 + rx) * 2 * heat;
                        ry += Math.cos(time * 20 + ry) * 2 * heat;
                        
                        ctx.fillStyle = this.getHeatColor(heat);
                        ctx.fillRect(rx, ry, subSize + 0.5, subSize + 0.5);
                    }

                    if (fire > 0) {
                        if (this.fireAsset) {
                            // Approach B: Sprite-sheet (8-frame linear)
                            const frameCount = 8;
                            const frame = Math.floor((time * 15 + i) % frameCount);
                            const fw = this.fireAsset.width / frameCount;
                            const fh = this.fireAsset.height;
                            const fx = frame * fw;
                            const fy = 0;
                            
                            ctx.drawImage(this.fireAsset, fx, fy, fw, fh, rx - subSize*0.5, ry - subSize, subSize*2, subSize*2);
                        } else {
                            // Approach A: Procedural Fallback
                            const pulse = 0.8 + Math.sin(time * 30 + i) * 0.2;
                            ctx.fillStyle = `rgba(255, ${Math.floor(100 + Math.random() * 100)}, 0, ${pulse})`;
                            ctx.fillRect(rx, ry, subSize + 0.5, subSize + 0.5);
                            
                            // More detailed flame-like particles for Procedural
                            ctx.fillStyle = `rgba(255, ${Math.floor(200 + Math.random() * 55)}, 0, 0.8)`;
                            ctx.fillRect(rx + subSize*0.2, ry - subSize*0.5*fire, subSize*0.6, subSize*fire);
                        }
                        
                        // Sparks (shared)
                        if (Math.random() < 0.1) {
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
        if (this.isSubTileDestroyed(worldX, worldY)) return 0;
        const tx = Math.floor(worldX / this.tileSize);
        const ty = Math.floor(worldY / this.tileSize);
        const data = this.heatData.get(`${tx},${ty}`);
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

    

                return this.hpData.has(`${tx},${ty}`);

    

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

    

        }

    

        

    