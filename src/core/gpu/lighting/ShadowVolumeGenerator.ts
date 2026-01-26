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

    /**
     * Generates a shadow volume for a circular entity.
     * Creates a capsule shape (rectangle with rounded end) matching CPU implementation.
     */
    public static getCircleShadowVolume(
        lightDir: Point,    // Normalized direction of light travel (FROM sun TO scene)
        center: Point,      // Entity center in world coords
        radius: number,     // Entity radius
        shadowLen: number   // Shadow length
    ): ShadowPolygon | null {
        // Calculate angle of light direction
        const angle = Math.atan2(lightDir.y, lightDir.x);

        // Calculate two tangent points perpendicular to light direction
        // These form the "base" of the capsule at the entity edge
        const t1x = center.x + Math.cos(angle - Math.PI / 2) * radius;
        const t1y = center.y + Math.sin(angle - Math.PI / 2) * radius;
        const t2x = center.x + Math.cos(angle + Math.PI / 2) * radius;
        const t2y = center.y + Math.sin(angle + Math.PI / 2) * radius;

        // Project tangent points in light direction to form rectangle body
        const t3x = t2x + lightDir.x * shadowLen;
        const t3y = t2y + lightDir.y * shadowLen;
        const t4x = t1x + lightDir.x * shadowLen;
        const t4y = t1y + lightDir.y * shadowLen;

        // Create rectangle body vertices
        const rectVertices: Point[] = [
            { x: t1x, y: t1y },
            { x: t2x, y: t2y },
            { x: t3x, y: t3y },
            { x: t4x, y: t4y }
        ];

        // Generate semicircle at the FAR end (away from entity)
        // The semicircle connects t4 to t3, bulging OUTWARD (away from entity)
        const numCapPoints = 8;
        const capVertices: Point[] = [];

        // Project the center to find the cap center
        const capCenterX = center.x + lightDir.x * shadowLen;
        const capCenterY = center.y + lightDir.y * shadowLen;

        // t4 is at (angle - 90°), t3 is at (angle + 90°)
        // To arc OUTWARD (away from entity), we go from (angle - 90°) toward angle, then to (angle + 90°)
        // This is the FORWARD arc, not the backward one
        for (let i = 0; i <= numCapPoints; i++) {
            // Start at angle - 90° (t4 position), sweep through angle (pointing away), end at angle + 90° (t3)
            const capAngle = (angle - Math.PI / 2) + (i / numCapPoints) * Math.PI;
            capVertices.push({
                x: capCenterX + Math.cos(capAngle) * radius,
                y: capCenterY + Math.sin(capAngle) * radius
            });
        }

        // Build polygon: t1 -> t4 (near to far left) -> semicircle (already includes t4 to t3) -> t2 (far to near right)
        // Note: capVertices[0] ≈ t4, capVertices[last] ≈ t3, so we don't duplicate them
        const allVertices: Point[] = [
            { x: t1x, y: t1y },
            ...capVertices,       // Includes t4 -> arc -> t3
            { x: t2x, y: t2y }    // Back to near right corner (closes to t1)
        ];

        return { vertices: allVertices };
    }
}
