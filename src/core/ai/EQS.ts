import { World } from "../World";
import { EQSQuery, EQSPoint, EQSTestType } from "./EQSTypes";

export class EQS {
    public static runQuery(world: World, query: EQSQuery, targetPos?: {x: number, y: number}): EQSPoint[] {
        const points: EQSPoint[] = [];
        const { center, radius, density } = query;

        // 1. Generate Points (Ring/Grid pattern)
        // For simplicity, we'll use concentric rings
        const rings = 3;
        const pointsPerRing = Math.floor(density / rings);
        
        for (let r = 1; r <= rings; r++) {
            const currentRadius = (radius / rings) * r;
            for (let i = 0; i < pointsPerRing; i++) {
                const angle = (i / pointsPerRing) * Math.PI * 2;
                const x = center.x + Math.cos(angle) * currentRadius;
                const y = center.y + Math.sin(angle) * currentRadius;

                // Basic wall check - don't even consider points inside walls
                if (!world.isWall(x, y)) {
                    points.push({
                        x, y,
                        score: 0,
                        normalizedScore: 0,
                        metadata: new Map()
                    });
                }
            }
        }

        if (points.length === 0) return [];

        // 2. Run Tests
        for (const test of query.tests) {
            let minScore = Infinity;
            let maxScore = -Infinity;

            // First pass: Calculate raw scores for this test
            for (const pt of points) {
                let rawScore = 0;
                switch (test.type) {
                    case EQSTestType.DISTANCE:
                        if (targetPos) {
                            const dist = Math.sqrt(Math.pow(pt.x - targetPos.x, 2) + Math.pow(pt.y - targetPos.y, 2));
                            // Higher score if closer to preferred distance
                            const preferred = test.params?.preferred || 200;
                            rawScore = 1.0 - Math.min(1.0, Math.abs(dist - preferred) / 500);
                        }
                        break;

                    case EQSTestType.LINE_OF_SIGHT:
                        if (targetPos) {
                            const dx = targetPos.x - pt.x;
                            const dy = targetPos.y - pt.y;
                            const dist = Math.sqrt(dx * dx + dy * dy);
                            const angle = Math.atan2(dy, dx);
                            const hit = world.raycast(pt.x, pt.y, angle, dist);
                            rawScore = (hit === null) ? 1.0 : 0.0;
                        }
                        break;

                    case EQSTestType.PROXIMITY_TO_WALL:
                        // Check if point is near a wall (good for cover)
                        const isNearWall = world.checkWallCollision(pt.x, pt.y, 30) !== null;
                        rawScore = isNearWall ? 1.0 : 0.0;
                        break;
                }

                pt.metadata.set(test.type, rawScore);
                pt.score += rawScore * test.weight;
            }
        }

        // 3. Normalize
        let minTotal = Infinity;
        let maxTotal = -Infinity;
        for (const pt of points) {
            if (pt.score < minTotal) minTotal = pt.score;
            if (pt.score > maxTotal) maxTotal = pt.score;
        }

        const range = maxTotal - minTotal;
        for (const pt of points) {
            pt.normalizedScore = range === 0 ? 1.0 : (pt.score - minTotal) / range;
        }

        // Sort by score descending
        return points.sort((a, b) => b.score - a.score);
    }
}
