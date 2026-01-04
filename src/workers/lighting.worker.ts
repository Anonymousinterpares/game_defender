import { VisibilitySystem, Point } from '../core/VisibilitySystem';

self.onmessage = (e: MessageEvent) => {
    const { type, data } = e.data;

    if (type === 'calculateVisibility') {
        const { id, origin, segments, radius, startAngle, endAngle } = data;
        
        const polygon = VisibilitySystem.calculateVisibility(
            origin,
            segments,
            radius,
            startAngle,
            endAngle
        );

        (self as any).postMessage({
            type: 'visibilityResult',
            data: { id, polygon }
        });
    }
};
