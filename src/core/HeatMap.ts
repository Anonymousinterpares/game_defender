export class HeatMap {
    // Stores heat for tiles as Map<TileKey, Float32Array(100)>
    // TileKey is "x,y"
    private heatData: Map<string, Float32Array> = new Map();
    private activeTiles: Set<string> = new Set();
    private scorchData: Map<string, Uint8Array> = new Map(); // Permanent marks
    
    private subDiv: number = 10; // 10x10 sub-elements per tile
    private decayRate: number = 0.05; // 20s to cool down
    private spreadRate: number = 0.1; // Internal conduction
    
    private lastSimTime: number = 0;
    private simInterval: number = 3; // Simulate every 3 frames
    private frameCount: number = 0;

    constructor(private tileSize: number) {}

    public addHeat(worldX: number, worldY: number, amount: number, radius: number): void {
        const tx = Math.floor(worldX / this.tileSize);
        const ty = Math.floor(worldY / this.tileSize);
        
        // Heat affected tiles in radius
        const tileRadius = Math.ceil(radius / this.tileSize);
        for (let ry = -tileRadius; ry <= tileRadius; ry++) {
            for (let rx = -tileRadius; rx <= tileRadius; rx++) {
                const curTX = tx + rx;
                const curTY = ty + ry;
                this.applyHeatToTile(curTX, curTY, worldX, worldY, amount, radius);
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

        for (let i = 0; i < data.length; i++) {
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
                
                // Permanent Scorch
                if (data[i] > 0.5) {
                    let sData = this.scorchData.get(key);
                    if (!sData) {
                        sData = new Uint8Array(this.subDiv * this.subDiv);
                        this.scorchData.set(key, sData);
                    }
                    sData[i] = 1;
                }
            }
        }
    }

    public update(dt: number): void {
        this.frameCount++;
        if (this.frameCount % this.simInterval !== 0) return;

        const effectiveDT = dt * this.simInterval;
        const toRemove: string[] = [];

        this.activeTiles.forEach(key => {
            const data = this.heatData.get(key)!;
            let hasHeat = false;

            // 1. Internal Conduction (Spread)
            const nextData = new Float32Array(data);
            for (let y = 0; y < this.subDiv; y++) {
                for (let x = 0; x < this.subDiv; x++) {
                    const idx = y * this.subDiv + x;
                    const val = data[idx];
                    if (val <= 0) continue;

                    // Average with neighbors
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
                    
                    // 2. Decay
                    nextData[idx] = Math.max(0, nextData[idx] - this.decayRate * effectiveDT);
                    if (nextData[idx] > 0.01) hasHeat = true;
                }
            }
            
            data.set(nextData);
            if (!hasHeat) toRemove.push(key);
        });

        toRemove.forEach(k => this.activeTiles.delete(k));
    }

    public render(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number): void {
        const subSize = this.tileSize / this.subDiv;
        const viewW = ctx.canvas.width;
        const viewH = ctx.canvas.height;
        const time = performance.now() * 0.001;

        this.heatData.forEach((data, key) => {
            const [tx, ty] = key.split(',').map(Number);
            const worldX = tx * this.tileSize;
            const worldY = ty * this.tileSize;

            if (worldX + this.tileSize < cameraX || worldX > cameraX + viewW ||
                worldY + this.tileSize < cameraY || worldY > cameraY + viewH) return;

            const sData = this.scorchData.get(key);

            for (let i = 0; i < data.length; i++) {
                const heat = data[i];
                const scorched = sData ? sData[i] : 0;
                
                if (heat < 0.01 && !scorched) continue;

                const sx = i % this.subDiv;
                const sy = Math.floor(i / this.subDiv);
                let rx = worldX + sx * subSize;
                let ry = worldY + sy * subSize;

                // Heat Haze Distortion
                if (heat > 0.6) {
                    rx += Math.sin(time * 20 + rx) * 2 * heat;
                    ry += Math.cos(time * 20 + ry) * 2 * heat;
                }

                if (scorched && heat < 0.1) {
                    ctx.fillStyle = 'rgba(0,0,0,0.5)';
                    ctx.fillRect(rx, ry, subSize + 0.5, subSize + 0.5);
                }

                if (heat >= 0.01) {
                    const color = this.getHeatColor(heat);
                    ctx.fillStyle = color;
                    ctx.fillRect(rx, ry, subSize + 0.5, subSize + 0.5);
                    
                    if (heat > 0.8) {
                        ctx.shadowBlur = 5;
                        ctx.shadowColor = '#fff';
                        ctx.fillRect(rx, ry, subSize, subSize);
                        ctx.shadowBlur = 0;
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
        return data[subY * this.subDiv + subX] || 0;
    }
}
