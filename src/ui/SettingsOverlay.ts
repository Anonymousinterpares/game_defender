import { ConfigManager, ConfigItem } from '../config/MasterConfig';
import { EventBus, GameEvent } from '../core/EventBus';
import { WeatherManager } from '../core/WeatherManager';
import { SoundManager } from '../core/SoundManager';
import { WorldClock } from '../core/WorldClock';

export class SettingsOverlay {
    private container: HTMLDivElement | null = null;
    private isOpen: boolean = false;
    private currentTab: string = 'World'; // Default tab

    constructor() { }

    public toggle(): void {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.open();
        } else {
            this.close();
        }
    }

    private open(): void {
        const uiLayer = document.getElementById('ui-layer');
        if (!uiLayer) return;

        if (!this.container) {
            this.createUI(uiLayer);
        }

        // Add 'open' class for animation
        // Use setTimeout to allow DOM insertion before transition
        requestAnimationFrame(() => {
            if (this.container) this.container.classList.add('open');
        });
    }

    private close(): void {
        if (this.container) {
            this.container.classList.remove('open');
            // Remove from DOM after transition matches CSS (0.3s)
            setTimeout(() => {
                if (this.container && !this.container.classList.contains('open')) {
                    this.container.remove();
                    this.container = null;
                }
            }, 300);
        }
        this.isOpen = false;
    }

    public dispose(): void {
        this.isOpen = false;
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
    }

    private createUI(parent: HTMLElement): void {
        this.container = document.createElement('div');
        this.container.className = 'settings-overlay-container';

        // Structure
        this.container.innerHTML = `
            <div class="overlay-content">
                <div class="overlay-header">
                    <h3>GAME SETTINGS</h3>
                    <button class="hud-btn" id="btn-close-overlay">X</button>
                </div>
                <div class="overlay-body">
                    <div class="overlay-sidebar"></div>
                    <div class="overlay-controls"></div>
                </div>
            </div>
        `;

        parent.appendChild(this.container);

        // Bind Close
        const closeBtn = this.container.querySelector('#btn-close-overlay');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
                this.toggle();
            });
        }

        this.renderSidebar();
        this.renderContent();
    }

    private renderSidebar(): void {
        if (!this.container) return;
        const sidebar = this.container.querySelector('.overlay-sidebar');
        if (!sidebar) return;

        sidebar.innerHTML = '';
        const schema = ConfigManager.getInstance().getSchema();
        const categories = Object.keys(schema);

        // Filter out Keybindings for now as they are complex to handle in overlay
        // or just let them show up but be empty?
        // Current requirement says "all settings". Let's exclude Keybindings for simpler Phase 1 or include if safe.
        // Implementation Plan said "reusing Schema", so we will include all. 
        // Note: Keybindings might be tricky in a small panel, but let's try.

        categories.forEach(cat => {
            const btn = document.createElement('button');
            btn.textContent = cat;
            btn.className = `tab-btn ${cat === this.currentTab ? 'active' : ''}`;
            btn.onclick = () => {
                EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
                this.currentTab = cat;
                this.renderSidebar(); // Re-render to update active state
                this.renderContent();
            };
            sidebar.appendChild(btn);
        });
    }

    private renderContent(): void {
        if (!this.container) return;
        const content = this.container.querySelector('.overlay-controls');
        if (!content) return;

        content.innerHTML = '';
        const schema = ConfigManager.getInstance().getSchema();

        if (this.currentTab === 'Keybindings') {
            content.innerHTML = '<p style="color:#888; padding:10px;">Keybindings must be changed in the main menu.</p>';
            return;
        }

        const categoryData = schema[this.currentTab];
        if (!categoryData) return;

        for (const [key, item] of Object.entries(categoryData)) {
            const control = this.createControlElement(this.currentTab, key, item as ConfigItem<any>);
            content.appendChild(control);
        }
    }

    private createControlElement(category: string, key: string, item: ConfigItem<any>): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.className = 'control-group';

        const label = document.createElement('label');
        label.textContent = item.description;
        wrapper.appendChild(label);

        if (item.type === 'number' && item.min !== undefined && item.max !== undefined) {
            const flex = document.createElement('div');
            flex.className = 'control-flex';
            flex.style.display = 'flex';
            flex.style.alignItems = 'center';
            flex.style.gap = '10px';

            const range = document.createElement('input');
            range.type = 'range';
            range.min = item.min.toString();
            range.max = item.max.toString();
            range.step = (item.step || 1).toString();
            range.value = item.value.toString();

            const display = document.createElement('span');
            display.className = 'value-display';
            display.textContent = item.value.toString();

            range.addEventListener('input', (e) => {
                const val = parseFloat((e.target as HTMLInputElement).value);
                display.textContent = val.toString();
                this.applySetting(category, key, val);
            });

            flex.appendChild(range);
            flex.appendChild(display);
            wrapper.appendChild(flex);

        } else if (item.type === 'boolean') {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = item.value as boolean;
            checkbox.addEventListener('change', (e) => {
                const val = (e.target as HTMLInputElement).checked;
                this.applySetting(category, key, val);
            });
            wrapper.appendChild(checkbox);

        } else if (item.options && item.options.length > 0) {
            const select = document.createElement('select');
            item.options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt;
                option.textContent = opt.toUpperCase();
                if (opt === item.value) option.selected = true;
                select.appendChild(option);
            });
            select.addEventListener('change', (e) => {
                const val = (e.target as HTMLSelectElement).value;
                this.applySetting(category, key, val);
            });
            wrapper.appendChild(select);
        } else if (item.type === 'color') {
            const picker = document.createElement('input');
            picker.type = 'color';
            picker.value = item.value as string;
            picker.addEventListener('input', (e) => {
                this.applySetting(category, key, (e.target as HTMLInputElement).value);
            });
            wrapper.appendChild(picker);
        } else {
            // Fallback text
            const input = document.createElement('div');
            input.textContent = JSON.stringify(item.value);
            input.style.fontSize = '0.8em';
            input.style.color = '#888';
            wrapper.appendChild(input);
        }

        return wrapper;
    }

    private applySetting(category: string, key: string, value: any): void {
        ConfigManager.getInstance().set(category, key, value);

        // Immediate application logic mirrored from SettingsScene
        // Most systems read in loop, but some need force-refresh
        if (category === 'Weather') {
            WeatherManager.getInstance().refreshConfig();
        } else if (category === 'TimeSystem') {
            WorldClock.getInstance().reset();
        } else if (category === 'Audio' && key === 'masterVolume') {
            SoundManager.getInstance().setVolume(value);
        }
    }
}
