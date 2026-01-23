import { HeatMapState } from './HeatMapState';
import { TileSummary } from './HeatMapTypes';

export class HeatMapRenderer {
    private scratchCanvas: HTMLCanvasElement | null = null;
    private scratchCtx: CanvasRenderingContext2D | null = null;
    private scratchImageData: ImageData | null = null;
    private scratchUint32: Uint32Array | null = null;

    private static heatColorLUT: Uint32Array = new Uint32Array(256);
    private static moltenColorLUT: Uint32Array = new Uint32Array(256);
    private static lutsInitialized: boolean = false;

    private fireAsset: HTMLImageElement | null = null;

    constructor() {
        if (!HeatMapRenderer.lutsInitialized) {
            this.initLUTs();
        }
        this.loadAssets();
    }

    private initLUTs() {
        for (let i = 0; i < 256; i++) {
            const intensity = i / 255;
            const components = this.getHeatColorComponents(intensity);
            const alpha = Math.floor((intensity < 0.8 ? (0.4 + intensity * 0.6) : 1.0) * 255);
            // ImageData is RGBA, so Uint32 in Little Endian is 0xAABBGGRR
            HeatMapRenderer.heatColorLUT[i] = (alpha << 24) | (components.b << 16) | (components.g << 8) | components.r;

            // Molten: Gold/Orange
            const mAlpha = Math.floor(Math.min(1.0, intensity) * 255);
            HeatMapRenderer.moltenColorLUT[i] = (mAlpha << 24) | (0 << 16) | (200 << 8) | 255;
        }
        HeatMapRenderer.lutsInitialized = true;
    }

    private loadAssets() {
        this.fireAsset = new Image();
        this.fireAsset.src = `${import.meta.env.BASE_URL}assets/fire_sheet.png`;
    }

    private getHeatColorComponents(intensity: number): { r: number, g: number, b: number } {
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

    public render(state: HeatMapState, ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, tileSize: number, gpuActive: boolean = false): void {
        // Skip CPU rendering if GPU mode is handling heat visuals
        if (gpuActive) return;

        const viewW = ctx.canvas.width;
        const viewH = ctx.canvas.height;
        const time = performance.now() * 0.001;
        const subDiv = state.subDiv;

        if (!this.scratchCanvas) {
            this.scratchCanvas = document.createElement('canvas');
            this.scratchCanvas.width = subDiv;
            this.scratchCanvas.height = subDiv;
            this.scratchCtx = this.scratchCanvas.getContext('2d')!;
            this.scratchImageData = this.scratchCtx.createImageData(subDiv, subDiv);
            this.scratchUint32 = new Uint32Array(this.scratchImageData.data.buffer);
        }

        const sCtx = this.scratchCtx!;
        const sCanv = this.scratchCanvas!;
        const sData = this.scratchImageData!;
        const sU32 = this.scratchUint32!;

        state.activeTiles.forEach(key => {
            const [tx, ty] = key.split(',').map(Number);
            const worldX = tx * tileSize;
            const worldY = ty * tileSize;

            if (worldX + tileSize < cameraX || worldX > cameraX + viewW ||
                worldY + tileSize < cameraY || worldY > cameraY + viewH) return;

            const heatData = state.heatData.get(key);
            const fireData = state.fireData.get(key);
            const hData = state.hpData.get(key);
            const moltenData = state.moltenData.get(key);

            if (!heatData && !fireData && !moltenData) return;

            // 1. Render Blended Heat Glow using LUT
            if (heatData) {
                let hasSignificantHeat = false;
                sU32.fill(0);

                for (let i = 0; i < heatData.length; i++) {
                    const h = heatData[i];
                    if (h > 0.4 && (!hData || hData[i] <= 0)) {
                        hasSignificantHeat = true;
                        const lutIdx = Math.floor(h * 255);
                        sU32[i] = HeatMapRenderer.heatColorLUT[lutIdx];
                    }
                }

                if (hasSignificantHeat) {
                    sCtx.putImageData(sData, 0, 0);
                    ctx.save();
                    ctx.imageSmoothingEnabled = true;
                    ctx.drawImage(sCanv, worldX, worldY, tileSize, tileSize);
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
                        sU32[i] = HeatMapRenderer.moltenColorLUT[lutIdx];
                    }
                }

                if (hasMolten) {
                    sCtx.putImageData(sData, 0, 0);
                    ctx.save();
                    ctx.imageSmoothingEnabled = true;
                    ctx.globalCompositeOperation = 'screen';
                    ctx.globalAlpha = 0.5;
                    ctx.drawImage(sCanv, worldX - 4, worldY - 4, tileSize + 8, tileSize + 8);
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.globalAlpha = 0.95;
                    ctx.drawImage(sCanv, worldX, worldY, tileSize, tileSize);
                    ctx.restore();
                }
            }

            // 3. Render Fire
            if (fireData) {
                const summary = state.tileSummaries.get(key);
                if (summary && summary.burningCount > 0) {
                    const qSize = subDiv / 2;
                    const quadWorldSize = tileSize / 2;

                    for (let qy = 0; qy < 2; qy++) {
                        for (let qx = 0; qx < 2; qx++) {
                            let quadIntensity = 0;
                            let burningInQuad = 0;

                            for (let sy = qy * qSize; sy < (qy + 1) * qSize; sy++) {
                                for (let sx = qx * qSize; sx < (qx + 1) * qSize; sx++) {
                                    const fIdx = sy * subDiv + sx;
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

    public getHeatColor(intensity: number): string {
        const { r, g, b } = this.getHeatColorComponents(intensity);
        return `rgba(${r}, ${g}, ${b}, ${0.4 + intensity * 0.6})`;
    }
}
