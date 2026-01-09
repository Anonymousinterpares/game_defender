export interface EQSPoint {
    x: number;
    y: number;
    score: number;
    normalizedScore: number;
    metadata: Map<string, any>;
}

export enum EQSTestType {
    DISTANCE = 'distance',
    LINE_OF_SIGHT = 'los',
    PROXIMITY_TO_WALL = 'wall_proximity',
    PROXIMITY_TO_ALLIES = 'ally_proximity',
    DIRECTION_TO_TARGET = 'direction'
}

export interface EQSTest {
    type: EQSTestType;
    weight: number; // Positive for attraction, negative for repulsion
    params?: any;
}

export interface EQSQuery {
    center: { x: number, y: number };
    radius: number;
    density: number; // Number of points or spacing
    tests: EQSTest[];
}
