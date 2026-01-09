import { World } from "../core/World";
import { HeatMap } from "../core/HeatMap";

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
        canBreach: boolean = false,
        isHeatProof: boolean = false
    ): {x: number, y: number}[] {
        const ts = world.getTileSize();
        const heatMap: HeatMap | null = world.getHeatMap();
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
            openList.sort((a, b) => a.f - b.f);
            const current = openList.shift()!;

            if (current.x === endTX && current.y === endTY) {
                return this.reconstructPath(current, ts);
            }

            closedList.add(`${current.x},${current.y}`);

            const neighbors = this.getNeighbors(current, world);
            for (const neighbor of neighbors) {
                if (closedList.has(`${neighbor.x},${neighbor.y}`)) continue;

                const isWall = world.isWallByTile(neighbor.x, neighbor.y);
                if (isWall && !canBreach) continue;
                
                // 2. Heat check
                let heatCost = 0;
                if (!isHeatProof && heatMap) {
                    const isFire = heatMap.isTileIgnited(neighbor.x, neighbor.y);
                    const heat = heatMap.getAverageIntensity(neighbor.x, neighbor.y);
                    
                    if (isFire) heatCost += 20; // Very high cost for active fire
                    else if (heat > 0.5) heatCost += 5; // Moderate cost for high heat
                }
                
                // --- THETA* LOGIC ---
                let parent = current;
                let gScore = 0;

                if (current.parent && this.hasLineOfSight(current.parent, neighbor, world, ts)) {
                    // Shortcut: Parent of current becomes parent of neighbor
                    parent = current.parent;
                    const dx = neighbor.x - parent.x;
                    const dy = neighbor.y - parent.y;
                    gScore = parent.g + Math.sqrt(dx * dx + dy * dy) + heatCost;
                } else {
                    const dx = neighbor.x - current.x;
                    const dy = neighbor.y - current.y;
                    const stepCost = Math.sqrt(dx * dx + dy * dy);
                    gScore = current.g + (isWall ? 15 : stepCost) + heatCost;
                }

                let openNode = openList.find(n => n.x === neighbor.x && n.y === neighbor.y);
                if (!openNode) {
                    const newNode: Node = {
                        x: neighbor.x,
                        y: neighbor.y,
                        g: gScore,
                        h: this.heuristic(neighbor.x, neighbor.y, endTX, endTY),
                        f: 0,
                        parent: parent
                    };
                    newNode.f = newNode.g + newNode.h;
                    openList.push(newNode);
                } else if (gScore < openNode.g) {
                    openNode.g = gScore;
                    openNode.f = openNode.g + openNode.h;
                    openNode.parent = parent;
                }
            }

            if (closedList.size > 800) break;
        }

        return [];
    }

    private static heuristic(x1: number, y1: number, x2: number, y2: number): number {
        // Octile distance for 8-way movement
        const dx = Math.abs(x1 - x2);
        const dy = Math.abs(y1 - y2);
        return (dx + dy) + (Math.sqrt(2) - 2) * Math.min(dx, dy);
    }

    private static getNeighbors(node: Node, world: World): {x: number, y: number}[] {
        const neighbors = [];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                
                const nx = node.x + dx;
                const ny = node.y + dy;
                
                if (nx >= 0 && nx < world.getWidth() && ny >= 0 && ny < world.getHeight()) {
                    // Check diagonal accessibility (prevent cutting corners through solid walls)
                    if (dx !== 0 && dy !== 0) {
                        const wall1 = world.isWallByTile(node.x + dx, node.y);
                        const wall2 = world.isWallByTile(node.x, node.y + dy);
                        // If both adjacent tiles are walls, can't move diagonally between them
                        if (wall1 && wall2) continue; 
                    }
                    neighbors.push({ x: nx, y: ny });
                }
            }
        }
        return neighbors;
    }

    private static hasLineOfSight(n1: {x: number, y: number}, n2: {x: number, y: number}, world: World, ts: number): boolean {
        const x1 = n1.x * ts + ts / 2;
        const y1 = n1.y * ts + ts / 2;
        const x2 = n2.x * ts + ts / 2;
        const y2 = n2.y * ts + ts / 2;
        
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        
        // Use a slightly more conservative raycast for pathfinding (half-tile steps)
        const hit = world.raycast(x1, y1, angle, dist);
        return hit === null;
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
