import { Simulation } from "../Simulation";
import { IPlugin } from "./IPlugin";
import { LightManager } from "../LightManager";

export class ChaosPlugin implements IPlugin {
    public readonly id = "debug-chaos";
    public readonly name = "Chaos Debug Plugin";

    private timer = 0;
    private active = true;

    public onInstall(sim: Simulation): void {
        console.log("CHAOS PLUGIN: Installed and Active");
    }

    public update(dt: number): void {
        if (!this.active) return;

        this.timer += dt;
        if (this.timer > 0.2) { // Faster flashes
            this.timer = 0;
            // Randomly flash lights near the player
            const sim = (window as any).currentSim; // Global hack for debug if needed, but let's use the player pos if possible
            // Since we don't have easy access to player here without searching entities, 
            // let's just use random world coords for now but confirm they are added.
            const lm = LightManager.getInstance();
            lm.addConstantLight({
                id: "chaos_flash_" + Math.random(),
                x: Math.random() * 5000,
                y: Math.random() * 5000,
                radius: 1000,
                color: `rgb(${Math.random()*255}, ${Math.random()*255}, ${Math.random()*255})`,
                intensity: 3.0,
                type: 'transient',
                ttl: 0.2
            });
        }
    }

    public render(ctx: CanvasRenderingContext2D): void {
        if (!this.active) return;
        
        // DRAW IN SCREEN SPACE (Reset transform temporarily or use fixed coords)
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset to screen space
        
        if (Math.random() > 0.9) {
            ctx.strokeStyle = "rgba(255, 0, 255, 0.8)";
            ctx.lineWidth = 4;
            const y = Math.random() * window.innerHeight;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(window.innerWidth, y);
            ctx.stroke();
            
            // Add some text too
            ctx.fillStyle = "magenta";
            ctx.font = "bold 40px monospace";
            ctx.fillText("SYSTEM CRITICAL", 50, y - 10);
        }
        ctx.restore();
    }

    public onUninstall(sim: Simulation): void {
        console.log("CHAOS PLUGIN: Uninstalled");
    }
}