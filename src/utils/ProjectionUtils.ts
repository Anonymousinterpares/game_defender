export class ProjectionUtils {
    /**
     * Strength of the parallax effect. 
     * Higher values mean more leaning.
     */
    private static readonly PERSPECTIVE_STRENGTH = 0.0015;

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
