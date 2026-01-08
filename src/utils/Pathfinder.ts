import { World } from "../core/World";

interface Node {
    x: number;
    y: number;
    g: number; // Cost from start
    h: number; // Heuristic cost to end
    f: number; // Total cost
    parent: Node | null;
}

export class Pathfinder {
    public static findPath(
        world: World, 
        startX: number, 
        startY: number, 
        endX: number, 
        endY: number,
        canBreach: boolean = false
    ): {x: number, y: number}[] {
        const ts = world.getTileSize();
        const startTX = Math.floor(startX / ts);
        const startTY = Math.floor(startY / ts);
        const endTX = Math.floor(endX / ts);
        const endTY = Math.floor(endY / ts);

        // Sanity check
        if (startTX === endTX && startTY === endTY) return [];

        const openList: Node[] = [];
        const closedList: Set<string> = new Set();

        const startNode: Node = {
            x: startTX,
            y: startTY,
            g: 0,
            h: this.heuristic(startTX, startTY, endTX, endTY),
            f: 0,
            parent: null
        };
        startNode.f = startNode.g + startNode.h;
        openList.push(startNode);

        while (openList.length > 0) {
            // Sort by F score (simplistic, could be optimized with priority queue)
            openList.sort((a, b) => a.f - b.f);
            const current = openList.shift()!;

            if (current.x === endTX && current.y === endTY) {
                return this.reconstructPath(current, ts);
            }

            closedList.add(`${current.x},${current.y}`);

            const neighbors = this.getNeighbors(current, world);
            for (const neighbor of neighbors) {
                if (closedList.has(`${neighbor.x},${neighbor.y}`)) continue;

                // Wall check
                const isWall = world.isWallByTile(neighbor.x, neighbor.y);
                if (isWall && !canBreach) continue;
                
                // Extra cost for walls if we can breach
                const moveCost = isWall ? 10 : 1; 
                const gScore = current.g + moveCost;

                let openNode = openList.find(n => n.x === neighbor.x && n.y === neighbor.y);
                if (!openNode) {
                    const newNode: Node = {
                        x: neighbor.x,
                        y: neighbor.y,
                        g: gScore,
                        h: this.heuristic(neighbor.x, neighbor.y, endTX, endTY),
                        f: 0,
                        parent: current
                    };
                    newNode.f = newNode.g + newNode.h;
                    openList.push(newNode);
                } else if (gScore < openNode.g) {
                    openNode.g = gScore;
                    openNode.f = openNode.g + openNode.h;
                    openNode.parent = current;
                }
            }

            // Safety break to prevent infinite loops in weird cases
            if (closedList.size > 1000) break;
        }

        return [];
    }

    private static heuristic(x1: number, y1: number, x2: number, y2: number): number {
        return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    }

    private static getNeighbors(node: Node, world: World): {x: number, y: number}[] {
        const neighbors = [
            {x: node.x + 1, y: node.y},
            {x: node.x - 1, y: node.y},
            {x: node.x, y: node.y + 1},
            {x: node.x, y: node.y - 1}
        ];
        return neighbors.filter(n => 
            n.x >= 0 && n.x < world.getWidth() && 
            n.y >= 0 && n.y < world.getHeight()
        );
    }

    private static reconstructPath(node: Node, ts: number): {x: number, y: number}[] {
        const path = [];
        let curr: Node | null = node;
        while (curr) {
            path.push({
                x: curr.x * ts + ts / 2,
                y: curr.y * ts + ts / 2
            });
            curr = curr.parent;
        }
        return path.reverse();
    }
}
