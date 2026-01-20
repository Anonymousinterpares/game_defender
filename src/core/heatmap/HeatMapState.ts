import { TileSummary, HEATMAP_SETTINGS } from './HeatMapTypes';

export class HeatMapState {
    public heatData: Map<string, Float32Array> = new Map();
    public fireData: Map<string, Float32Array> = new Map();
    public moltenData: Map<string, Float32Array> = new Map();
    public hpData: Map<string, Float32Array> = new Map();
    public materialData: Map<string, Uint8Array> = new Map();
    public scorchData: Map<string, Uint8Array> = new Map();
    public whiteHeatTime: Map<string, Float32Array> = new Map();

    public activeTiles: Set<string> = new Set();
    public tileSummaries: Map<string, TileSummary> = new Map();
    public recentlyDeactivated: Set<string> = new Set();

    public readonly subDiv = HEATMAP_SETTINGS.subDiv;

    constructor() { }

    public clear() {
        this.heatData.clear();
        this.fireData.clear();
        this.moltenData.clear();
        this.hpData.clear();
        this.materialData.clear();
        this.scorchData.clear();
        this.whiteHeatTime.clear();
        this.activeTiles.clear();
        this.tileSummaries.clear();
        this.recentlyDeactivated.clear();
    }

    public getDeltaState(): any[] {
        const delta: any[] = [];

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

        this.recentlyDeactivated.forEach(key => {
            delta.push({ k: key, c: 1 });
        });
        this.recentlyDeactivated.clear();

        return delta;
    }

    public applyDeltaState(delta: any[], onTileClear: (key: string) => void, onTileChange: (key: string) => void): void {
        delta.forEach(d => {
            const key = d.k;

            if (d.c === 1) {
                this.forceClear(key);
                onTileClear(key);
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
                if (!s) { s = new Uint8Array(this.subDiv * this.subDiv); this.scorchData.set(key, s); }
                const serverS = d.s;
                let changed = false;
                for (let i = 0; i < serverS.length; i++) {
                    if (s[i] !== serverS[i]) {
                        s[i] = serverS[i];
                        changed = true;
                    }
                }
                if (changed) {
                    onTileChange(key);
                }
            }
        });
    }

    public forceClear(key: string): void {
        this.heatData.delete(key);
        this.fireData.delete(key);
        this.moltenData.delete(key);
        this.activeTiles.delete(key);
    }

    private compressFloatArray(arr: Float32Array): number[] {
        const res: number[] = [];
        let hasNonZero = false;
        for (let i = 0; i < arr.length; i++) {
            const v = Math.round(arr[i] * 100) / 100;
            res.push(v);
            if (v > 0.01) hasNonZero = true;
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
