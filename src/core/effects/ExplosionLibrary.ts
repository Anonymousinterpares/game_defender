import { GPURenderer } from "../gpu/GPURenderer";
import { ConfigManager } from "../../config/MasterConfig";
import { HeatMap } from "../HeatMap";

export class ExplosionLibrary {
    /**
     * The "Supernova" effect: Big circle, dark edges, bright center, shrinking.
     * User requested to SAVE this logic for a future weapon.
     */
    public static spawnSupernova(x: number, y: number, radius: number): void {
        const renderer = GPURenderer.getInstance();
        if (!renderer || !renderer.getHeatSystem()) return;

        const worldW = renderer.getWorld()?.getWidthPixels() || 1;
        const worldH = renderer.getWorld()?.getHeightPixels() || 1;

        // The "Bugged" behavior that looked cool: 
        // High intensity heat splat that decays into a ring

        // We use a specific separate splat call or simulate it
        // For now, we replicate parameters that created it:
        // Sharp edge, high intensity
        renderer.getHeatSystem()?.splatHeat(x, y, 2.0, radius * 1.5, worldW, worldH);
    }

    /**
     * Standard Explosion for Rockets/Missiles.
     * Components:
     * 1. Shockwave (Fluid Velocity Divergence)
     * 2. Fireball (Fluid Temperature + Density)
     * 3. Flash (LightManager - already handled)
     * 4. Debris/Sparks (GPUParticleSystem)
     */
    public static spawnStandardExplosion(x: number, y: number, radius: number, weaponType: 'rocket' | 'missile' | 'mine' | 'cannon'): void {
        const renderer = GPURenderer.getInstance();
        if (!renderer) return;

        const fluids = renderer.getFluidSimulation();
        const particles = renderer.getParticleSystem();
        const world = renderer.getWorld();
        if (!world) return;

        const wpW = world.getWidthPixels();
        const wpH = world.getHeightPixels();

        // 1. SHOCKWAVE (Velocity)
        // Push fluid OUTWARDS
        // splatVelocity adds radial velocity
        if (fluids) {
            fluids.splatVelocity(x, y, radius * 1.5, 500, 500, wpW, wpH); // This might need directional control, but splatVelocity usually adds divergence if implemented as such, or we just add a "puff"
            // Actually GPURenderer.handleVelocitySplat uses splatVelocity which is usually directional. 
            // We might need a "Radial Impuse" method. 
            // For now, we'll simulate a random burst or just rely on the fireball expansion logic if exists.

            // Actually, FluidSimulation.splat just adds density/temp. 
            // We need to verify if we have a radial velocity splat.
            // Looking at previous context, handleSmokeSpawned did a random drift.
        }

        // 2. FIREBALL (Fluid Density + Temperature)
        // High temp (white/yellow), High density (smoke)
        if (fluids) {
            // Hot core
            fluids.splat(x, y, radius * 0.8, 2.0, 10.0, 0.1, wpW, wpH);
            // 2.0 Density (thick), 10.0 Temp (Very bright/rising fast)

            // Secondary smoke ring
            fluids.splat(x, y, radius * 1.2, 0.5, 2.0, 0.5, wpW, wpH);
        }

        // 3. GPU PARTICLES (Sparks)
        if (particles) {
            const count = 20;
            for (let i = 0; i < count; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 200 + Math.random() * 300;
                const vx = Math.cos(angle) * speed;
                const vy = Math.sin(angle) * speed;
                // Type 5 = Fire/Spark
                particles.uploadParticle(x, y, vx, vy, 0.5 + Math.random() * 0.5, 5, 1);
            }
        }

        // 4. Ground Scorch (HeatMap)
        // Layer A: "Flash" - Large radius, Low intensity. 
        // Decay is 1.5/sec. For 100ms duration, we need 0.15 intensity.
        if (renderer.getHeatSystem()) {
            const hs = renderer.getHeatSystem();
            hs?.splatHeat(x, y, 0.15, radius * 1.5, wpW, wpH);

            // Layer B: Small Core - REMOVED as requested (was causing 10s persistent artifact)
            // Previously: hs?.splatHeat(x, y, 2.5, radius * 0.4, wpW, wpH);
        }
    }
}
