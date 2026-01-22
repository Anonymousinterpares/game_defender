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
                    <div style="display: flex; gap: 10px;">
                        <button class="hud-btn" id="btn-reset-defaults" style="border-color: #ff3300; color: #ff3300;">RESET DEFAULTS</button>
                        <button class="hud-btn" id="btn-close-overlay">X</button>
                    </div>
                </div>
                <div class="overlay-body">
                    <div class="overlay-sidebar"></div>
                    <div class="overlay-controls"></div>
                </div>
            </div>
        `;

        parent.appendChild(this.container);

        // Bind Buttons
        const resetBtn = this.container.querySelector('#btn-reset-defaults');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to reset all settings to default? The page will reload.')) {
                    EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
                    ConfigManager.getInstance().resetToDefaults();
                }
            });
        }

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

        // Filter out Keybindings from sidebar if needed, but keeping for now.

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

        // Special TimeSystem Controls
        if (this.currentTab === 'TimeSystem') {
            this.renderTimeControls(content);
        }

        const categoryData = schema[this.currentTab];
        if (!categoryData) return;

        for (const [key, item] of Object.entries(categoryData)) {
            const control = this.createControlElement(this.currentTab, key, item as ConfigItem<any>);
            content.appendChild(control);
        }
    }

    private renderTimeControls(parent: Element): void {
        const wrapper = document.createElement('div');
        wrapper.style.marginBottom = '20px';
        wrapper.style.padding = '10px';
        wrapper.style.border = '1px dashed var(--steam-gold)';
        wrapper.style.background = 'rgba(0,0,0,0.2)';

        wrapper.innerHTML = '<h4 style="margin:0 0 10px 0; color:var(--steam-gold);">DEBUG: TIME TRAVEL</h4>';

        // Time of Day Slider
        const timeGroup = document.createElement('div');
        timeGroup.className = 'control-group';
        timeGroup.innerHTML = '<label>SET TIME OF DAY (0-24)</label>';
        const timeFlex = document.createElement('div');
        timeFlex.style.display = 'flex';
        timeFlex.style.gap = '10px';

        const timeSlider = document.createElement('input');
        timeSlider.type = 'range';
        timeSlider.min = '0';
        timeSlider.max = '24';
        timeSlider.step = '0.1';
        timeSlider.value = WorldClock.getInstance().getHour().toString();
        timeSlider.style.flex = '1';

        const timeDisplay = document.createElement('span');
        timeDisplay.className = 'value-display';
        timeDisplay.textContent = parseFloat(timeSlider.value).toFixed(1);

        timeSlider.addEventListener('input', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            timeDisplay.textContent = val.toFixed(1);
            WorldClock.getInstance().setHour(val);
        });

        timeFlex.appendChild(timeSlider);
        timeFlex.appendChild(timeDisplay);
        timeGroup.appendChild(timeFlex);
        wrapper.appendChild(timeGroup);

        // Moon Phase Slider
        const moonGroup = document.createElement('div');
        moonGroup.className = 'control-group';
        moonGroup.innerHTML = '<label>SET MOON PHASE (0.0-1.0)</label>';
        const moonFlex = document.createElement('div');
        moonFlex.style.display = 'flex';
        moonFlex.style.gap = '10px';

        const moonSlider = document.createElement('input');
        moonSlider.type = 'range';
        moonSlider.min = '0';
        moonSlider.max = '1';
        moonSlider.step = '0.01';
        moonSlider.value = WorldClock.getInstance().getMoonPhase().toString();
        moonSlider.style.flex = '1';

        const moonDisplay = document.createElement('span');
        moonDisplay.className = 'value-display';
        moonDisplay.textContent = parseFloat(moonSlider.value).toFixed(2);

        moonSlider.addEventListener('input', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            moonDisplay.textContent = val.toFixed(2);
            WorldClock.getInstance().setMoonPhase(val);
        });

        moonFlex.appendChild(moonSlider);
        moonFlex.appendChild(moonDisplay);
        moonGroup.appendChild(moonFlex);
        wrapper.appendChild(moonGroup);

        parent.appendChild(wrapper);
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
