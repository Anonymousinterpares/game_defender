export enum ParticleType {
    STANDARD = 0,
    SHOCKWAVE = 1,
    FLASH = 2,
    MOLTEN = 3
}

export const FLAG_ACTIVE = 1 << 0;
export const FLAG_IS_FLAME = 1 << 1;

export const MAX_PARTICLES = 10000;

// Total properties: 13 Float32 properties + 3 Uint8/Uint32 properties
// We'll use this to calculate buffer sizes if we want a single SAB
