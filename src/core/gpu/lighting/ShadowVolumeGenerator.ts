export interface Point {
    x: number;
    y: number;
}

export interface ShadowPolygon {
    vertices: Point[];
}

export class ShadowVolumeGenerator {
    /**
     * Generates a shadow volume polygon for a line segment relative to a light source.
     */
    public static getShadowVolumeFromSegment(lightPos: Point, a: Point, b: Point, range: number): ShadowPolygon | null {
        // Project endpoints
        const projA = this.project(lightPos, a, range);
        const projB = this.project(lightPos, b, range);

        // Quad: a, b, projB, projA
        return {
            vertices: [a, b, projB, projA]
        };
    }

    /**
     * Generates a shadow volume polygon for a rectangular obstacle (AABB)
     * relative to a light source.
     */
    public static getShadowVolume(lightPos: Point, rect: { x: number, y: number, w: number, h: number }, range: number): ShadowPolygon | null {
        // 1. Get all corners of the rect
        const corners: Point[] = [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.w, y: rect.y },
            { x: rect.x + rect.w, y: rect.y + rect.h },
            { x: rect.x, y: rect.y + rect.h }
        ];

        // 2. Sort corners by angle relative to light
        const sorted = corners.map(p => {
            return {
                p,
                angle: Math.atan2(p.y - lightPos.y, p.x - lightPos.x)
            };
        });

        // Angular sorting is tricky if it crosses the -PI/PI boundary.
        // We find the "span" of angles.
        sorted.sort((a, b) => a.angle - b.angle);

        // Check for boundary wrap (if span > PI, the "gap" is actually the sorted center)
        let firstIdx = 0;
        let lastIdx = 3;

        let maxGap = -1;
        let gapIdx = -1;
        for (let i = 0; i < 4; i++) {
            const next = (i + 1) % 4;
            let diff = sorted[next].angle - sorted[i].angle;
            if (diff < 0) diff += Math.PI * 2;
            if (diff > maxGap) {
                maxGap = diff;
                gapIdx = i;
            }
        }

        // The silhouette points are the ones on either side of the largest angular gap
        const p1 = sorted[(gapIdx + 1) % 4].p;
        const p2 = sorted[gapIdx].p;

        // 3. Project silhouette points outward
        const proj1 = this.project(lightPos, p1, range);
        const proj2 = this.project(lightPos, p2, range);

        // 4. Return as a quad (or triangle if very close, but quad is standard)
        // Vertices: p1, p2, proj2, proj1 (Standard CCW or CW order)
        return {
            vertices: [p1, proj1, proj2, p2]
        };
    }

    private static project(origin: Point, p: Point, range: number): Point {
        const dx = p.x - origin.x;
        const dy = p.y - origin.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return p;

        // Project to at least 2x the range to ensure it clears the light radius comfortably
        const scale = (len + range * 2.0) / len;
        return {
            x: origin.x + dx * scale,
            y: origin.y + dy * scale
        };
    }

    /**
     * Generates a shadow volume projected infinitely (or by range) along a direction vector.
     */
    public static getDirectionalShadowVolume(dir: Point, a: Point, b: Point, range: number): ShadowPolygon | null {
        // dir should be normalized
        const projA = { x: a.x + dir.x * range, y: a.y + dir.y * range };
        const projB = { x: b.x + dir.x * range, y: b.y + dir.y * range };

        return {
            vertices: [a, b, projB, projA]
        };
    }
}
