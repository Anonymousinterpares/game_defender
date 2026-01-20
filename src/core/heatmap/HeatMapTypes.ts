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

export const HEATMAP_SETTINGS = {
    subDiv: 10,
    decayRate: 0.0125,
    spreadRate: 0.1
};
