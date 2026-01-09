import { Component } from "../Component";
import { AIBehavior, EnemyDossier } from "./AIDossier";
import { GOAPGoal, GOAPPlan } from "../../ai/GOAPTypes";
import { EQSPoint } from "../../ai/EQSTypes";

export interface Waypoint {
    x: number;
    y: number;
}

export class AIComponent implements Component {
    public readonly type = 'ai';
    
    // Movement & Navigation
    public path: Waypoint[] = [];
    public nextWaypointIndex: number = 0;
    public lastPathUpdateTime: number = 0;
    public waitTimer: number = 0; 
    
    // Higher-Level Decision Making (GOAP)
    public currentGoal: GOAPGoal | null = null;
    public currentPlan: GOAPPlan | null = null;
    public currentActionIndex: number = -1;
    
    // Spatial Awareness (EQS)
    public eqsPoints: EQSPoint[] = [];
    public bestTacticalPoint: Waypoint | null = null;
    public lastEQSUpdateTime: number = 0;

    // Perception Memory
    public perceivedTargetPos: Waypoint | null = null;
    public lastKnownPosition: Waypoint | null = null;
    public perceptionCertainty: number = 0; // 0 to 1
    public isAlert: boolean = false;
    public patrolTimer: number = 0;
    public patrolTarget: Waypoint | null = null;

    // Tactical Coordination
    public activeToken: string | null = null; // 'attack', 'flank', etc.
    public role: string = 'grunt'; // 'aggressor', 'supporter', 'flanker'
    
    public state: string = 'idle'; 
    public dossier: EnemyDossier | null = null;

    constructor(
        public behavior: AIBehavior = AIBehavior.CHASE,
        public targetId: string | null = null,
        public speed: number = 150
    ) {}
}