import { MaterialType, MATERIAL_PROPS, HEATMAP_SETTINGS, TileSummary } from './HeatMapTypes';
import { HeatMapState } from './HeatMapState';
import { ConfigManager } from '../../config/MasterConfig';
import { SoundManager } from '../SoundManager';
import { WeatherManager } from '../WeatherManager';
import { FloorDecalManager } from '../FloorDecalManager';

export class HeatMapSimulator {
    // Zero-allocation scratch buffers
    private scratchHeat: Float32Array;
    private scratchFire: Float32Array;
    private scratchMolten: Float32Array;
    private frameCount: number = 0;

    constructor() {
        this.scratchHeat = new Float32Array(HEATMAP_SETTINGS.subDiv * HEATMAP_SETTINGS.subDiv);
        this.scratchFire = new Float32Array(HEATMAP_SETTINGS.subDiv * HEATMAP_SETTINGS.subDiv);
        this.scratchMolten = new Float32Array(HEATMAP_SETTINGS.subDiv * HEATMAP_SETTINGS.subDiv);
    }

    public update(state: HeatMapState, dt: number, widthTiles: number, heightTiles: number, tileSize: number, worldRef: any): void {
        this.frameCount++;
        const toRemove: string[] = [];
        const soundMgr = SoundManager.getInstance();
        const subDiv = state.subDiv;

        state.activeTiles.forEach(key => {
            const [tx, ty] = key.split(',').map(Number);

            // Skip boundaries
            if (tx <= 0 || tx >= widthTiles - 1 || ty <= 0 || ty >= heightTiles - 1) {
                state.activeTiles.delete(key);
                state.recentlyDeactivated.add(key);
                return;
            }

            const data = state.heatData.get(key);
            const summary = state.tileSummaries.get(key);
            if (data && summary) {
                WeatherManager.getInstance().removeSnowFromHeat(tx, ty, data, tileSize, summary.maxHeat);
            }

            const fData = state.fireData.get(key);
            const mlData = state.moltenData.get(key);
            const mData = state.materialData.get(key);
            const hData = state.hpData.get(key);
            let wData = state.whiteHeatTime.get(key);
            if (!wData) {
                wData = new Float32Array(subDiv * subDiv);
                state.whiteHeatTime.set(key, wData);
            }

            let hasActivity = false;
            let burningSubTiles = 0;
            let maxHeat = 0;
            let sumHeat = 0;
            let maxMolten = 0;

            // Zero-allocation scratch preparation
            if (data) this.scratchHeat.set(data); else this.scratchHeat.fill(0);
            if (fData) this.scratchFire.set(fData); else this.scratchFire.fill(0);
            if (mlData) this.scratchMolten.set(mlData); else this.scratchMolten.fill(0);

            for (let y = 0; y < subDiv; y++) {
                for (let x = 0; x < subDiv; x++) {
                    const idx = y * subDiv + x;
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

                            if (nSx >= 0 && nSx < subDiv && nSy >= 0 && nSy < subDiv) {
                                sum += data![nSy * subDiv + nSx];
                                count++;
                                continue;
                            }

                            const offsetTx = (nSx < 0 ? -1 : (nSx >= subDiv ? 1 : 0));
                            const offsetTy = (nSy < 0 ? -1 : (nSy >= subDiv ? 1 : 0));
                            const nTx = tx + offsetTx;
                            const nTy = ty + offsetTy;

                            if (nTx <= 0 || nTx >= widthTiles - 1 || nTy <= 0 || nTy >= heightTiles - 1) continue;

                            const nKey = `${nTx},${nTy}`;
                            let nd = state.heatData.get(nKey);

                            if (isHot && !nd && !state.activeTiles.has(nKey)) {
                                nd = new Float32Array(subDiv * subDiv);
                                state.heatData.set(nKey, nd);
                                state.activeTiles.add(nKey);
                            }

                            if (nd) {
                                const wrappedSx = (nSx + subDiv) % subDiv;
                                const wrappedSy = (nSy + subDiv) % subDiv;
                                sum += nd[wrappedSy * subDiv + wrappedSx];
                                count++;
                            }
                        }
                        const avg = sum / count;
                        this.scratchHeat[idx] = val + (avg - val) * HEATMAP_SETTINGS.spreadRate;
                        this.scratchHeat[idx] = Math.max(0, this.scratchHeat[idx] - HEATMAP_SETTINGS.decayRate * dt);

                        const finalHeat = this.scratchHeat[idx];
                        if (finalHeat > 0.01) {
                            hasActivity = true;
                            if (finalHeat > maxHeat) maxHeat = finalHeat;
                            sumHeat += finalHeat;
                        }

                        if (finalHeat > 0.95 && !isDestroyed) {
                            wData[idx] += dt;
                            const mat = material as MaterialType;
                            if (wData[idx] >= MATERIAL_PROPS[mat].vaporizeTime) {
                                if (hData) hData[idx] = 0;
                                if (worldRef) {
                                    worldRef.markMeshDirty(tx, ty);
                                    worldRef.notifyTileChange(tx, ty);
                                    worldRef.checkTileDestruction(tx, ty);
                                }
                                if (mat === MaterialType.METAL) {
                                    this.scratchMolten[idx] = 1.0;
                                    hasActivity = true;
                                }
                                this.scratchHeat[idx] = 0.5;
                            }
                        } else {
                            wData[idx] = Math.max(0, wData[idx] - dt);
                        }
                    }

                    // --- METAL MELTING ---
                    if (material === MaterialType.METAL && this.scratchHeat[idx] > 0.5 && !isDestroyed) {
                        const leakAmount = (this.scratchHeat[idx] - 0.4) * 0.8 * dt;
                        const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]];

                        for (const [nx, ny] of neighbors) {
                            let nx_sub = x + nx;
                            let ny_sub = y + ny;
                            let nKey = key;

                            if (nx_sub < 0 || nx_sub >= subDiv || ny_sub < 0 || ny_sub >= subDiv) {
                                const ntx = tx + (nx_sub < 0 ? -1 : (nx_sub >= subDiv ? 1 : 0));
                                const nty = ty + (ny_sub < 0 ? -1 : (ny_sub >= subDiv ? 1 : 0));
                                nKey = `${ntx},${nty}`;
                                nx_sub = (nx_sub + subDiv) % subDiv;
                                ny_sub = (ny_sub + subDiv) % subDiv;
                            }

                            const nhData = state.hpData.get(nKey);
                            const nIdx = ny_sub * subDiv + nx_sub;

                            if (!nhData || nhData[nIdx] <= 0) {
                                let nmData = state.moltenData.get(nKey);
                                if (!nmData) {
                                    nmData = new Float32Array(subDiv * subDiv);
                                    state.moltenData.set(nKey, nmData);
                                    state.activeTiles.add(nKey);
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

                                    if (nx_sub < 0 || nx_sub >= subDiv || ny_sub < 0 || ny_sub >= subDiv) {
                                        const ntx = tx + (nx_sub < 0 ? -1 : (nx_sub >= subDiv ? 1 : 0));
                                        const nty = ty + (ny_sub < 0 ? -1 : (ny_sub >= subDiv ? 1 : 0));
                                        nKey = `${ntx},${nty}`;
                                        nx_sub = (nx_sub + subDiv) % subDiv;
                                        ny_sub = (ny_sub + subDiv) % subDiv;
                                    }

                                    const nIdx = ny_sub * subDiv + nx_sub;
                                    const nhData = state.hpData.get(nKey);

                                    if (!nhData || nhData[nIdx] <= 0) {
                                        let n_nmData = state.moltenData.get(nKey);
                                        if (!n_nmData) {
                                            n_nmData = new Float32Array(subDiv * subDiv);
                                            state.moltenData.set(nKey, n_nmData);
                                            state.activeTiles.add(nKey);
                                        }
                                        const flowRate = 2.0 * (1 + this.scratchHeat[idx]);
                                        const spreadAmount = (pressure - 0.05) * flowRate * dt;
                                        if (spreadAmount > 0.001) {
                                            n_nmData[nIdx] = Math.min(2.0, n_nmData[nIdx] + spreadAmount);
                                            this.scratchMolten[idx] -= spreadAmount * 0.9;
                                        }
                                    }
                                }
                            }

                            if (this.scratchHeat[idx] < 0.2) {
                                const worldX = tx * tileSize + (x + 0.5) * (tileSize / subDiv);
                                const worldY = ty * tileSize + (y + 0.5) * (tileSize / subDiv);
                                FloorDecalManager.getInstance().addCooledMetalMark(worldX, worldY, (tileSize / subDiv) * (0.5 + this.scratchMolten[idx] * 2.0));
                                this.scratchMolten[idx] = 0;
                            }
                        }
                    }

                    // --- FIRE LOGIC ---
                    if (this.scratchFire[idx] > 0 && material === MaterialType.WOOD) {
                        hasActivity = true;
                        burningSubTiles++;

                        if (this.frameCount % 4 === 0) {
                            const speedMult = ConfigManager.getInstance().get<number>('Fire', 'fireSpreadSpeed') || 0.4;
                            const fireInc = dt * 0.5 * speedMult;
                            this.scratchFire[idx] += fireInc;
                            this.scratchHeat[idx] = Math.min(1.0, this.scratchHeat[idx] + this.scratchFire[idx] * 0.2);

                            if (hData) hData[idx] -= dt * 2.5 * speedMult;

                            if (this.scratchFire[idx] > 0.3) {
                                const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                                for (const [nx, ny] of neighbors) {
                                    let nSx = x + nx;
                                    let nSy = y + ny;
                                    if (nSx >= 0 && nSx < subDiv && nSy >= 0 && nSy < subDiv) {
                                        const nIdx = nSy * subDiv + nSx;
                                        if (this.scratchFire[nIdx] === 0 && hData && hData[nIdx] > 0) {
                                            if (Math.random() < 0.2 * speedMult) {
                                                this.scratchFire[nIdx] = 0.05;
                                            }
                                        }
                                    } else {
                                        const nTx = tx + (nSx < 0 ? -1 : (nSx >= subDiv ? 1 : 0));
                                        const nTy = ty + (nSy < 0 ? -1 : (nSy >= subDiv ? 1 : 0));
                                        if (nTx <= 0 || nTx >= widthTiles - 1 || nTy <= 0 || nTy >= heightTiles - 1) continue;
                                        const nKey = `${nTx},${nTy}`;
                                        const wrappedSx = (nSx + subDiv) % subDiv;
                                        const wrappedSy = (nSy + subDiv) % subDiv;
                                        const nIdx = wrappedSy * subDiv + wrappedSx;
                                        const nmData = state.materialData.get(nKey);
                                        if (nmData && MATERIAL_PROPS[nmData[nIdx] as MaterialType].flammable) {
                                            if (Math.random() < 0.05 * speedMult) {
                                                this.ignite(state, nTx, nTy, nIdx, tileSize);
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        if (hData && hData[idx] <= 0) {
                            if (worldRef) {
                                worldRef.markMeshDirty(tx, ty);
                                worldRef.notifyTileChange(tx, ty);
                                worldRef.checkTileDestruction(tx, ty);
                            }
                            this.scratchFire[idx] = 0;
                            this.scratchHeat[idx] = 0.2;
                        }
                    }
                }
            }

            // Update summary
            state.tileSummaries.set(key, {
                burningCount: burningSubTiles,
                maxHeat: maxHeat,
                maxMolten: maxMolten,
                avgHeat: sumHeat / (subDiv * subDiv)
            });

            if (burningSubTiles > 0) {
                const worldX = tx * tileSize + tileSize / 2;
                const worldY = ty * tileSize + tileSize / 2;
                soundMgr.updateAreaSound('fire', worldX, worldY, burningSubTiles);
            }

            // Save scratch buffers back to logical state
            if (data) data.set(this.scratchHeat);
            if (fData) fData.set(this.scratchFire);
            if (mlData) mlData.set(this.scratchMolten);

            if (!hasActivity) {
                let hasSettled = true;
                if (data) { for (let i = 0; i < data.length; i++) if (data[i] > 0.01) { hasSettled = false; break; } }
                if (hasSettled && fData) { for (let i = 0; i < fData.length; i++) if (fData[i] > 0.01) { hasSettled = false; break; } }
                if (hasSettled && mlData) { for (let i = 0; i < mlData.length; i++) if (mlData[i] > 0.01) { hasSettled = false; break; } }

                if (hasSettled) {
                    toRemove.push(key);
                    const mm = (window as any).MultiplayerManager?.getInstance();
                    if (!mm || mm.isHost) {
                        state.recentlyDeactivated.add(key);
                    }
                }
            }
        });

        toRemove.forEach(k => state.activeTiles.delete(k));
    }

    public ignite(state: HeatMapState, tx: number, ty: number, idx: number, tileSize: number): void {
        const key = `${tx},${ty}`;
        let fData = state.fireData.get(key);
        if (!fData) {
            fData = new Float32Array(state.subDiv * state.subDiv);
            state.fireData.set(key, fData);
        }
        if (fData[idx] === 0) {
            fData[idx] = 0.1;
            // Notify via the HeatMap facade if linked
            if ((this as any).facade && (this as any).facade.onIgnite) {
                const subSize = tileSize / state.subDiv;
                const worldX = tx * tileSize + (idx % state.subDiv + 0.5) * subSize;
                const worldY = ty * tileSize + (Math.floor(idx / state.subDiv) + 0.5) * subSize;
                (this as any).facade.onIgnite(worldX, worldY, 15); // Small radius for sub-tile
            }
        }
        state.activeTiles.add(key);
    }

    public applyScorch(state: HeatMapState, tx: number, ty: number, idx: number, worldRef: any): void {
        const key = `${tx},${ty}`;
        let sData = state.scorchData.get(key);
        if (!sData) {
            sData = new Uint8Array(state.subDiv * state.subDiv);
            state.scorchData.set(key, sData);
        }
        if (sData[idx] === 0) {
            sData[idx] = 1;
            if (worldRef) worldRef.notifyTileChange(tx, ty);
        }
    }
}
