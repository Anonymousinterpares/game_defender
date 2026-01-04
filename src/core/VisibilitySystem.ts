export interface Point {
    x: number;
    y: number;
}

export interface Segment {
    a: Point;
    b: Point;
    // Pre-calculated for speed
    minX?: number;
    maxX?: number;
    minY?: number;
    maxY?: number;
}

export class VisibilitySystem {
    /**
     * Calculates a visibility polygon.
     * @param origin The center of the light/vision.
     * @param segments Occlusion segments.
     * @param maxRadius Max distance for vision.
     * @param startAngle Optional start of vision cone (radians).
     * @param endAngle Optional end of vision cone (radians).
     */
    public static calculateVisibility(
        origin: Point, 
        segments: Segment[], 
        maxRadius: number = 1000,
        startAngle: number | null = null,
        endAngle: number | null = null
    ): Point[] {
        const angles: number[] = [];
        const filteredSegments: Segment[] = [];

        // Normalize angles for range check
        const normalize = (a: number) => {
            while (a < -Math.PI) a += Math.PI * 2;
            while (a > Math.PI) a -= Math.PI * 2;
            return a;
        };

        const isInsideCone = (angle: number) => {
            if (startAngle === null || endAngle === null) return true;
            const normA = normalize(angle);
            const s = normalize(startAngle);
            const e = normalize(endAngle);
            if (s < e) return normA >= s && normA <= e;
            return normA >= s || normA <= e; // Wraps through PI
        };

        // 1. Filter segments by radius and pre-calculate bounds
        const rSq = maxRadius * maxRadius;
        for (const seg of segments) {
            // Quick distance check (at least one point must be in range)
            const d1 = (seg.a.x - origin.x) ** 2 + (seg.a.y - origin.y) ** 2;
            const d2 = (seg.b.x - origin.x) ** 2 + (seg.b.y - origin.y) ** 2;
            
            if (d1 > rSq && d2 > rSq) {
                // Potential check for line passing through circle could be added here
                // but usually endpoint check is enough for clipped segments
                continue;
            }

            seg.minX = Math.min(seg.a.x, seg.b.x);
            seg.maxX = Math.max(seg.a.x, seg.b.x);
            seg.minY = Math.min(seg.a.y, seg.b.y);
            seg.maxY = Math.max(seg.a.y, seg.b.y);
            filteredSegments.push(seg);

            const angleA = Math.atan2(seg.a.y - origin.y, seg.a.x - origin.x);
            const angleB = Math.atan2(seg.b.y - origin.y, seg.b.x - origin.x);
            
            if (isInsideCone(angleA)) angles.push(angleA, angleA - 0.0001, angleA + 0.0001);
            if (isInsideCone(angleB)) angles.push(angleB, angleB - 0.0001, angleB + 0.0001);
        }

        // Add cone boundaries
        if (startAngle !== null) angles.push(startAngle);
        if (endAngle !== null) angles.push(endAngle);

        if (angles.length === 0) {
            if (startAngle !== null) return []; // Cone is empty
            angles.push(0, Math.PI / 2, Math.PI, -Math.PI / 2);
        }

        // 2. Raycast
        const sortedAngles = Array.from(new Set(angles)).sort((a, b) => a - b);
        const visibilityPolygon: Point[] = [];

        for (const angle of sortedAngles) {
            const dx = Math.cos(angle);
            const dy = Math.sin(angle);
            
            // Ray length is maxRadius
            const ray = { a: origin, b: { x: origin.x + dx * maxRadius, y: origin.y + dy * maxRadius } };
            
            let minT1 = 1.0; // t1 is now normalized to ray length
            let closestPoint: Point = { x: ray.b.x, y: ray.b.y };
            let found = false;

            for (const seg of filteredSegments) {
                // Quick bounding box check
                const rMinX = Math.min(ray.a.x, ray.b.x);
                const rMaxX = Math.max(ray.a.x, ray.b.x);
                const rMinY = Math.min(ray.a.y, ray.b.y);
                const rMaxY = Math.max(ray.a.y, ray.b.y);

                if (seg.maxX! < rMinX || seg.minX! > rMaxX || seg.maxY! < rMinY || seg.minY! > rMaxY) continue;

                const intersect = this.getIntersection(ray, seg);
                if (intersect && intersect.t1 < minT1) {
                    minT1 = intersect.t1;
                    closestPoint = intersect.p;
                    found = true;
                }
            }

            visibilityPolygon.push(closestPoint);
        }

        return visibilityPolygon;
    }

    private static getIntersection(ray: {a: Point, b: Point}, segment: Segment): {p: Point, t1: number} | null {
        const r_px = ray.a.x;
        const r_py = ray.a.y;
        const r_dx = ray.b.x - ray.a.x;
        const r_dy = ray.b.y - ray.a.y;

        const s_px = segment.a.x;
        const s_py = segment.a.y;
        const s_dx = segment.b.x - segment.a.x;
        const s_dy = segment.b.y - segment.a.y;

        const r_mag = Math.sqrt(r_dx * r_dx + r_dy * r_dy);
        const s_mag = Math.sqrt(s_dx * s_dx + s_dy * s_dy);
        if (r_mag === 0 || s_mag === 0) return null;

        // Determinant
        const det = s_dy * r_dx - s_dx * r_dy;
        if (Math.abs(det) < 0.0001) return null;

        const t2 = (r_dx * (s_py - r_py) + r_dy * (r_px - s_px)) / det;
        const t1 = (s_px + s_dx * t2 - r_px) / r_dx;

        if (t1 >= 0 && t1 <= 1 && t2 >= 0 && t2 <= 1) {
            return {
                p: { x: r_px + r_dx * t1, y: r_py + r_dy * t1 },
                t1: t1
            };
        }

        return null;
    }
}
