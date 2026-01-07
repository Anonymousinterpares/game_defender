import { Simulation } from "../Simulation";
import { IPlugin } from "./IPlugin";

export class PluginManager {
    private plugins: Map<string, IPlugin> = new Map();
    private sim: Simulation;

    constructor(sim: Simulation) {
        this.sim = sim;
    }

    public install(plugin: IPlugin): void {
        if (this.plugins.has(plugin.id)) {
            console.warn(`Plugin ${plugin.id} is already installed.`);
            return;
        }

        console.log(`Installing Plugin: ${plugin.name} (${plugin.id})`);
        this.plugins.set(plugin.id, plugin);
        plugin.onInstall(this.sim);
    }

    public uninstall(pluginId: string): void {
        const plugin = this.plugins.get(pluginId);
        if (plugin) {
            console.log(`Uninstalling Plugin: ${plugin.name}`);
            plugin.onUninstall(this.sim);
            this.plugins.delete(pluginId);
        }
    }

    public update(dt: number): void {
        for (const plugin of this.plugins.values()) {
            if (plugin.update) {
                plugin.update(dt);
            }
        }
    }

    public render(ctx: CanvasRenderingContext2D): void {
        for (const plugin of this.plugins.values()) {
            if (plugin.render) {
                plugin.render(ctx);
            }
        }
    }

    public getSyncStates(): Record<string, any> {
        const states: Record<string, any> = {};
        for (const [id, plugin] of this.plugins.entries()) {
            if (plugin.getSyncState) {
                states[id] = plugin.getSyncState();
            }
        }
        return states;
    }

    public applySyncStates(states: Record<string, any>): void {
        for (const [id, state] of Object.entries(states)) {
            const plugin = this.plugins.get(id);
            if (plugin && plugin.applySyncState) {
                plugin.applySyncState(state);
            }
        }
    }

    public getPlugin<T extends IPlugin>(id: string): T | undefined {
        return this.plugins.get(id) as T;
    }
}
