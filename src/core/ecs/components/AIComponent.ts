import { Component } from "../Component";
import { AIBehavior, EnemyDossier } from "./AIDossier";

export interface Waypoint {
    x: number;
    y: number;
}

export class AIComponent implements Component {
    public readonly type = 'ai';

    public path: Waypoint[] = [];
    public nextWaypointIndex: number = 0;
    public lastPathUpdateTime: number = 0;
    public waitTimer: number = 0; // Time to wait/retreat after an action
    public state: string = 'idle'; // Internal state like 'patrolling', 'chasing', 'fleeing'

    // Config/Preset
    public dossier: EnemyDossier | null = null;

    constructor(
        public behavior: AIBehavior = AIBehavior.CHASE,
        public targetId: string | null = null,
        public speed: number = 150,
        public thrust: number = 1000
    ) { }
}