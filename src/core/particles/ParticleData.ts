import { MAX_PARTICLES, FLAG_ACTIVE } from '../ParticleConstants';

export interface ParticleTarget {
    x: number;
    y: number;
    radius: number;
    active: boolean;
    isOnFire: boolean;
}

export class ParticleData {
    public sharedBuffer: SharedArrayBuffer;

    public x: Float32Array;
    public y: Float32Array;
    public z: Float32Array;
    public prevX: Float32Array;
    public prevY: Float32Array;
    public prevZ: Float32Array;
    public vx: Float32Array;
    public vy: Float32Array;
    public vz: Float32Array;
    public life: Float32Array;
    public maxLife: Float32Array;
    public radius: Float32Array;
    public startRadius: Float32Array;
    public type: Uint8Array;
    public flags: Uint8Array;
    public colorIdx: Uint32Array;

    // derived/helper data (main thread only usually, but good to have near data)
    public activeIndices: Uint32Array;
    public activeCount: number = 0;
    public nextFreeIdx: number = 0;
    public colorPalette: string[] = [];

    constructor(existingBuffer?: SharedArrayBuffer) {
        const count = MAX_PARTICLES;
        const f32Size = count * 4;
        const u32Size = count * 4;
        const u8SizeAligned = (count + 3) & ~3;

        const totalSize = (13 * f32Size) + (1 * u32Size) + (2 * u8SizeAligned);

        if (existingBuffer) {
            this.sharedBuffer = existingBuffer;
        } else {
            try {
                this.sharedBuffer = new (window.SharedArrayBuffer || ArrayBuffer)(totalSize) as any;
            } catch (e) {
                console.warn("SharedArrayBuffer not available, falling back to main thread physics.");
                this.sharedBuffer = new ArrayBuffer(totalSize) as any;
            }
        }

        let offset = 0;
        const getF32 = () => {
            const arr = new Float32Array(this.sharedBuffer, offset, count);
            offset += f32Size;
            return arr;
        };
        const getU32 = () => {
            const arr = new Uint32Array(this.sharedBuffer, offset, count);
            offset += u32Size;
            return arr;
        };
        const getU8 = () => {
            const arr = new Uint8Array(this.sharedBuffer, offset, count);
            offset += u8SizeAligned;
            return arr;
        };

        this.x = getF32(); this.y = getF32(); this.z = getF32();
        this.prevX = getF32(); this.prevY = getF32(); this.prevZ = getF32();
        this.vx = getF32(); this.vy = getF32(); this.vz = getF32();
        this.life = getF32(); this.maxLife = getF32();
        this.radius = getF32(); this.startRadius = getF32();
        this.type = getU8();
        this.flags = getU8(); // 4-byte aligned
        this.colorIdx = getU32();

        this.activeIndices = new Uint32Array(count);
    }

    public getNextIndex(): number {
        for (let i = 0; i < MAX_PARTICLES; i++) {
            const idx = (this.nextFreeIdx + i) % MAX_PARTICLES;
            if (!(this.flags[idx] & FLAG_ACTIVE)) {
                this.nextFreeIdx = (idx + 1) % MAX_PARTICLES;
                return idx;
            }
        }
        return -1;
    }

    public clear(): void {
        this.flags.fill(0);
        this.x.fill(0);
        this.y.fill(0);
        this.z.fill(0);
        this.vx.fill(0);
        this.vy.fill(0);
        this.vz.fill(0);
        this.life.fill(0);
        this.activeCount = 0;
        this.nextFreeIdx = 0;
    }
}
