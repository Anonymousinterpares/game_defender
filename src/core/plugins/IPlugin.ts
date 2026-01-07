import { Simulation } from "../Simulation";

/**
 * Defines the contract for any modular engine extension.
 * Plugins can inject ECS systems, handle their own state, and hook into the game loop.
 */
export interface IPlugin {
    /** Unique identifier for the plugin */
    readonly id: string;
    
    /** Human-readable name */
    readonly name: string;

    /** 
     * Called when the plugin is added to the Simulation.
     * Use this to register ECS systems, set up event listeners, etc.
     */
    onInstall(sim: Simulation): void;

    /** Called every frame before physics/ECS update */
    update?(dt: number): void;

    /** Called every frame for custom rendering (above the world) */
    render?(ctx: CanvasRenderingContext2D): void;

    /** 
     * Called when the plugin is removed.
     * Cleanup listeners, remove injected systems, etc.
     */
    onUninstall(sim: Simulation): void;

    /** Optional: Returns data that needs to be synced in multiplayer */
    getSyncState?(): any;

    /** Optional: Applies data received from the host */
    applySyncState?(state: any): void;
}
