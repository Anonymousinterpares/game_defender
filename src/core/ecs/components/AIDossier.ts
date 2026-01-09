export enum AIBehavior {
    STATIONARY = 'stationary',   // Stays put
    CHASE = 'chase',             // Direct path to player
    SNIPER = 'sniper',           // Tries to stay at a distance
    AMBUSH = 'ambush',           // Hides behind walls, then rushes
    KITE = 'kite',               // Attacks then runs away
    BREACHER = 'breacher',       // Paths through destructible walls
    KAMIKAZE = 'kamikaze',       // Charges and explodes
    FLOCK = 'flock'              // Stays near group
}

export interface EnemyTrait {
    id: string;
    description: string;
    modifiers?: {
        speedMul?: number;
        hpMul?: number;
        damageMul?: number;
        fireResistance?: boolean;
        shieldedFront?: boolean;
    };
}

export interface EnemyDossier {
    name: string;
    behavior: AIBehavior;
    baseStats: {
        hp: number;
        speed: number;
        radius: number;
        attackRange: number;
        preferredDistance?: number;
        contactDamage?: number; 
        // Sensory Stats
        visualRange: number;
        visualFOV: number; // in degrees
        hearingRange: number;
    };
    visuals: {
        color: string;
        shape: 'circle' | 'square' | 'triangle' | 'rocket';
        glowColor?: string;
    };
    traits: string[]; // IDs of traits
}

export const TRAIT_LIBRARY: Record<string, EnemyTrait> = {
    'heat_proof': {
        id: 'heat_proof',
        description: 'Immune to fire damage and ignores fire pathing costs',
        modifiers: { fireResistance: true }
    },
    'armored': {
        id: 'armored',
        description: 'Front-facing damage reduction',
        modifiers: { shieldedFront: true, speedMul: 0.8 }
    },
    'swift': {
        id: 'swift',
        description: 'Highly mobile but fragile',
        modifiers: { speedMul: 1.5, hpMul: 0.7 }
    },
    'tracker': {
        id: 'tracker',
        description: 'Always knows player location, ignores Line-of-Sight rules',
        modifiers: {}
    }
};
