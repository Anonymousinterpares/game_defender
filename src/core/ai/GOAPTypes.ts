export type WorldState = Map<string, any>;

export interface GOAPAction {
    name: string;
    cost: number;
    preconditions: WorldState;
    effects: WorldState;
    
    // Checks if the action is physically possible (e.g., has ammo)
    isValid(state: WorldState): boolean;
}

export interface GOAPGoal {
    name: string;
    priority: number;
    desiredState: WorldState;
}

export interface GOAPPlan {
    actions: GOAPAction[];
    totalCost: number;
}
