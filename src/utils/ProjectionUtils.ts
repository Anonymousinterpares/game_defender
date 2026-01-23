import { ConfigManager } from '../config/MasterConfig';

export class ProjectionUtils {
    /**
     * Strength of the parallax effect. 
     * Higher values mean more leaning.
     */
    public static get PERSPECTIVE_STRENGTH(): number {
        return ConfigManager.getInstance().get<number>('Visuals', 'perspectiveStrength') ?? 0.0015;
    }

    /**
     * Projects a 3D world point into 2D screen space with perspective lean.
     * @param x World X
     * @param y World Y (Ground plane)
     * @param z Height (usually negative for 'up')
     * @param cameraCenterX World X of screen center
     * @param cameraCenterY World Y of screen center
     */
    public static projectPoint(x: number, y: number, z: number, cameraCenterX: number, cameraCenterY: number) {
        const h = -z; // Height above ground
        const dx = x - cameraCenterX;
        const dy = y - cameraCenterY;

        return {
            x: x + dx * h * this.PERSPECTIVE_STRENGTH,
            y: y + z + dy * h * this.PERSPECTIVE_STRENGTH
        };
    }

    /**
     * Calculates the screen offset for an object based on its height and distance from the camera center.
     * @param worldX Object world X
     * @param worldY Object world Y
     * @param height Object height (z-axis, usually negative for 'up')
     * @param cameraCenterX World X coordinate of the screen center
     * @param cameraCenterY World Y coordinate of the screen center
     */
    public static getProjectedOffset(worldX: number, worldY: number, height: number, cameraCenterX: number, cameraCenterY: number) {
        // height is negative for UP, so we invert it for lean calculation
        const h = -height;
        if (h <= 0) return { x: 0, y: 0 };

        const dx = worldX - cameraCenterX;
        const dy = worldY - cameraCenterY;

        return {
            x: dx * h * this.PERSPECTIVE_STRENGTH,
            y: dy * h * this.PERSPECTIVE_STRENGTH
        };
    }
}
