export interface Point {
    x: number;
    y: number;
}

export interface Segment {
    a: Point;
    b: Point;
}

export class VisibilitySystem {
    public static calculateVisibility(origin: Point, segments: Segment[]): Point[] {
        const points: Set<number> = new Set();
        const angles: number[] = [];

        // Collect all unique endpoints and cast rays slightly offset to each side
        for (const seg of segments) {
            const angleA = Math.atan2(seg.a.y - origin.y, seg.a.x - origin.x);
            const angleB = Math.atan2(seg.b.y - origin.y, seg.b.x - origin.x);
            
            angles.push(angleA, angleA - 0.0001, angleA + 0.0001);
            angles.push(angleB, angleB - 0.0001, angleB + 0.0001);
        }

        // Add 4 cardinal directions if no angles found
        if (angles.length === 0) {
            angles.push(0, Math.PI / 2, Math.PI, -Math.PI / 2);
        }

        // Sort angles
        const sortedAngles = Array.from(new Set(angles)).sort((a, b) => a - b);
        const visibilityPolygon: Point[] = [];

        for (const angle of sortedAngles) {
            const dx = Math.cos(angle);
            const dy = Math.sin(angle);
            
            const ray = { a: origin, b: { x: origin.x + dx, y: origin.y + dy } };
            
            let minT1 = Infinity;
            let closestPoint: Point | null = null;

            for (const seg of segments) {
                const intersect = this.getIntersection(ray, seg);
                if (intersect && intersect.t1 < minT1) {
                    minT1 = intersect.t1;
                    closestPoint = intersect.p;
                }
            }

            if (closestPoint) {
                visibilityPolygon.push(closestPoint);
            }
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

        // Check if parallel
        const mag = Math.sqrt(r_dx * r_dx + r_dy * r_dy);
        const s_mag = Math.sqrt(s_dx * s_dx + s_dy * s_dy);
        if (r_dx / mag === s_dx / s_mag && r_dy / mag === s_dy / s_mag) return null;

        const T2 = (r_dx * (s_py - r_py) + r_dy * (r_px - s_px)) / (s_dx * r_dy - s_dy * r_dx);
        const T1 = (s_px + s_dx * T2 - r_px) / r_dx;

        if (T1 < 0) return null;
        if (T2 < 0 || T2 > 1) return null;

        return {
            p: { x: r_px + r_dx * T1, y: r_py + r_dy * T1 },
            t1: T1
        };
    }
}
