import { WorldState, GOAPAction, GOAPGoal, GOAPPlan } from "./GOAPTypes";

interface Node {
    state: WorldState;
    parent: Node | null;
    action: GOAPAction | null;
    g: number;
    h: number;
    f: number;
}

export class GOAPPlanner {
    public static plan(startState: WorldState, actions: GOAPAction[], goal: GOAPGoal): GOAPPlan | null {
        const openList: Node[] = [];
        const closedList: Set<string> = new Set();

        const startNode: Node = {
            state: startState,
            parent: null,
            action: null,
            g: 0,
            h: this.calculateHeuristic(startState, goal.desiredState),
            f: 0
        };
        startNode.f = startNode.g + startNode.h;
        openList.push(startNode);

        while (openList.length > 0) {
            openList.sort((a, b) => a.f - b.f);
            const current = openList.shift()!;

            if (this.isGoalMet(current.state, goal.desiredState)) {
                return this.reconstructPlan(current);
            }

            closedList.add(this.stateToKey(current.state));

            for (const action of actions) {
                if (action.isValid(current.state) && this.canApplyAction(action, current.state)) {
                    const nextState = this.applyAction(action, current.state);
                    const stateKey = this.stateToKey(nextState);

                    if (closedList.has(stateKey)) continue;

                    const gScore = current.g + action.cost;
                    let openNode = openList.find(n => this.stateToKey(n.state) === stateKey);

                    if (!openNode) {
                        const newNode: Node = {
                            state: nextState,
                            parent: current,
                            action: action,
                            g: gScore,
                            h: this.calculateHeuristic(nextState, goal.desiredState),
                            f: 0
                        };
                        newNode.f = newNode.g + newNode.h;
                        openList.push(newNode);
                    } else if (gScore < openNode.g) {
                        openNode.g = gScore;
                        openNode.f = openNode.g + openNode.h;
                        openNode.parent = current;
                    }
                }
            }
        }

        return null;
    }

    private static isGoalMet(current: WorldState, goal: WorldState): boolean {
        for (const [key, value] of goal.entries()) {
            if (current.get(key) !== value) return false;
        }
        return true;
    }

    private static canApplyAction(action: GOAPAction, state: WorldState): boolean {
        for (const [key, value] of action.preconditions.entries()) {
            if (state.get(key) !== value) return false;
        }
        return true;
    }

    private static applyAction(action: GOAPAction, state: WorldState): WorldState {
        const nextState = new Map(state);
        for (const [key, value] of action.effects.entries()) {
            nextState.set(key, value);
        }
        return nextState;
    }

    private static calculateHeuristic(state: WorldState, goal: WorldState): number {
        let count = 0;
        for (const [key, value] of goal.entries()) {
            if (state.get(key) !== value) count++;
        }
        return count;
    }

    private static stateToKey(state: WorldState): string {
        const sortedKeys = Array.from(state.keys()).sort();
        return sortedKeys.map(k => `${k}:${state.get(k)}`).join('|');
    }

    private static reconstructPlan(node: Node): GOAPPlan {
        const actions: GOAPAction[] = [];
        let curr: Node | null = node;
        let totalCost = 0;
        while (curr && curr.action) {
            actions.push(curr.action);
            totalCost += curr.action.cost;
            curr = curr.parent;
        }
        return {
            actions: actions.reverse(),
            totalCost
        };
    }
}
