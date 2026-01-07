import { Component } from "../Component";

export enum AIType {
    CHASE = 'chase',
    FLEE = 'flee',
    WANDER = 'wander'
}

export class AIComponent implements Component {
    public readonly type = 'ai';
    
    constructor(
        public aiType: AIType = AIType.CHASE,
        public targetId: string | null = null,
        public speed: number = 150
    ) {}
}
