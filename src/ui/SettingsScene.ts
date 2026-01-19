import { Scene } from '../core/Scene';
import { SceneManager } from '../core/SceneManager';
import { ConfigManager, ConfigItem } from '../config/MasterConfig';
import { EventBus, GameEvent } from '../core/EventBus';
import { InputManager } from '../core/InputManager';
import { WeatherManager, WeatherType } from '../core/WeatherManager';
import { SoundManager } from '../core/SoundManager';
import { WorldClock } from '../core/WorldClock';

interface RecordingState {
    action: string;
    isSecondary: boolean;
    element: HTMLElement;
}

export class SettingsScene implements Scene {
    private container: HTMLDivElement | null = null;
    private currentTab: string = 'World';
    private recording: RecordingState | null = null;
    private modalOverlay: HTMLDivElement | null = null;

    private keydownHandler: (e: KeyboardEvent) => void;

    constructor(
        private sceneManager: SceneManager,
        private inputManager: InputManager
    ) {
        this.keydownHandler = this.onKeyDown.bind(this);
    }

    onEnter(): void {
        this.createUI();
        window.addEventListener('keydown', this.keydownHandler);
    }

    onExit(): void {
        window.removeEventListener('keydown', this.keydownHandler);
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
        this.closeModal();
    }

    private onKeyDown(e: KeyboardEvent): void {
        if (this.recording) {
            e.preventDefault();
            e.stopPropagation();

            if (e.code === 'Escape') {
                this.cancelRecording();
            } else if (e.code === 'Enter') {
                // Confirm current (though usually we confirm by pressing a key)
                this.cancelRecording();
            } else {
                this.processNewKey(e.code);
            }
            return;
        }

        if (e.code === 'Escape' && !this.modalOverlay) {
            this.sceneManager.switchScene('menu');
        }
    }

    update(dt: number): void {
        // InputManager.update() is called in Game.ts loop
    }

    render(ctx: CanvasRenderingContext2D): void {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    private createUI(): void {
        const uiLayer = document.getElementById('ui-layer');
        if (!uiLayer) return;

        this.container = document.createElement('div');
        this.container.className = 'settings-panel';

        // Header
        const header = document.createElement('div');
        header.className = 'settings-header';
        header.innerHTML = `<h2>System Configuration</h2>`;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'CLOSE [ESC]';
        closeBtn.className = 'hud-btn';
        closeBtn.onclick = async () => {
            EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
            this.sceneManager.switchScene('menu');
        };
        header.appendChild(closeBtn);
        this.container.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'settings-body';
        this.container.appendChild(body);

        // Sidebar
        const sidebar = document.createElement('div');
        sidebar.className = 'settings-sidebar';
        body.appendChild(sidebar);

        // Content Panel
        const content = document.createElement('div');
        content.className = 'settings-content';
        body.appendChild(content);

        // Footer
        const footer = document.createElement('div');
        footer.className = 'settings-footer';
        footer.textContent = 'Hardware version 2.4.0 • Real-time synchronization active';
        this.container.appendChild(footer);

        // Sidebar Tabs
        const schema = ConfigManager.getInstance().getSchema();
        const categories = Object.keys(schema);
        if (!categories.includes('Keybindings')) {
            categories.push('Keybindings');
        }

        categories.forEach(cat => {
            const btn = document.createElement('button');
            btn.textContent = cat;
            btn.className = `tab-btn ${cat === this.currentTab ? 'active' : ''}`;

            btn.onclick = () => {
                if (this.recording) return;
                EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
                this.currentTab = cat;

                sidebar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                this.renderTabContent(content, cat);
            };

            sidebar.appendChild(btn);
        });

        this.renderTabContent(content, this.currentTab);
        uiLayer.appendChild(this.container);
    }

    private renderTabContent(container: HTMLElement, category: string): void {
        container.innerHTML = '';

        const header = document.createElement('h3');
        header.textContent = category;
        container.appendChild(header);

        if (category === 'Keybindings') {
            this.renderKeybindings(container);
            return;
        }

        const schema = ConfigManager.getInstance().getSchema();
        const categoryData = schema[category];

        for (const [key, item] of Object.entries(categoryData)) {
            const control = this.createControlElement(category, key, item as ConfigItem<any>);
            container.appendChild(control);
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
            const container = document.createElement('div');
            container.className = 'color-picker-container';
            const picker = document.createElement('input');
            picker.type = 'color';
            picker.value = item.value as string;
            picker.addEventListener('input', (e) => {
                const val = (e.target as HTMLInputElement).value;
                this.applySetting(category, key, val);
            });
            container.appendChild(picker);
            const palette = document.createElement('div');
            palette.className = 'palette-grid';
            const presets = this.generateColorPalette();
            presets.forEach(color => {
                const swatch = document.createElement('div');
                swatch.className = 'palette-swatch';
                swatch.style.backgroundColor = color;
                swatch.onclick = () => {
                    picker.value = color;
                    this.applySetting(category, key, color);
                    EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
                };
                palette.appendChild(swatch);
            });
            container.appendChild(palette);
            wrapper.appendChild(container);
        } else if (item.type === 'object') {
            const info = document.createElement('div');
            info.style.cssText = `background: rgba(0,0,0,0.3); padding: 15px; font-size: 0.85em; color: #888; border: 1px dashed var(--steam-iron); white-space: pre-wrap; font-family: monospace; line-height: 1.4;`;
            info.textContent = JSON.stringify(item.value, null, 2);
            wrapper.appendChild(info);
        } else {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = item.value as string;
            input.addEventListener('change', (e) => {
                const val = (e.target as HTMLInputElement).value;
                this.applySetting(category, key, val);
            });
            wrapper.appendChild(input);
        }
        return wrapper;
    }

    private renderKeybindings(container: HTMLElement): void {
        const schema = ConfigManager.getInstance().getSchema();
        const bindings = schema['Keybindings'];

        for (const [action, item] of Object.entries(bindings)) {
            const row = document.createElement('div');
            row.className = 'keybinding-row';

            const label = document.createElement('span');
            label.className = 'key-label';
            label.textContent = item.description;

            const keysContainer = document.createElement('div');
            keysContainer.className = 'keys-container';

            // Primary Key
            const primaryVal = document.createElement('span');
            primaryVal.className = 'key-value';
            if (!item.value || item.value === '---') {
                primaryVal.textContent = 'EMPTY';
                primaryVal.classList.add('empty');
            } else {
                primaryVal.textContent = item.value;
            }
            primaryVal.onclick = () => this.startRecording(action, false, primaryVal);
            keysContainer.appendChild(primaryVal);

            // Secondary Key
            const secondaryVal = document.createElement('span');
            secondaryVal.className = 'key-value';
            // @ts-ignore
            const secValue = item.secondary;
            if (!secValue || secValue === '---') {
                secondaryVal.textContent = 'EMPTY';
                secondaryVal.classList.add('empty');
            } else {
                secondaryVal.textContent = secValue;
            }
            secondaryVal.onclick = () => this.startRecording(action, true, secondaryVal);
            keysContainer.appendChild(secondaryVal);

            row.appendChild(label);
            row.appendChild(keysContainer);
            container.appendChild(row);
        }
    }

    private startRecording(action: string, isSecondary: boolean, element: HTMLElement): void {
        if (this.recording) this.cancelRecording();

        EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
        this.recording = { action, isSecondary, element };
        element.classList.add('recording');
        element.textContent = '...PRESS ANY KEY...';
    }

    private cancelRecording(): void {
        if (!this.recording) return;

        const item = ConfigManager.getInstance().getSchema()['Keybindings'][this.recording.action];
        // Restore text
        const val = this.recording.isSecondary ? (item.secondary || '---') : item.value;
        if (val === '---' || !val) {
            this.recording.element.textContent = 'EMPTY';
            this.recording.element.classList.add('empty');
        } else {
            this.recording.element.textContent = val;
            this.recording.element.classList.remove('empty');
        }
        this.recording.element.classList.remove('recording');
        this.recording = null;
    }

    private processNewKey(code: string): void {
        if (!this.recording) return;

        const action = this.recording.action;
        const isSecondary = this.recording.isSecondary;
        const element = this.recording.element;

        // Check for conflicts
        const conflict = this.findConflict(code);
        if (conflict && (conflict.action !== action || conflict.isSecondary !== isSecondary)) {
            this.showConflictModal(code, conflict.action, conflict.description, () => {
                this.applyKeyBinding(action, isSecondary, code, element);
                this.recording = null;
            });
        } else {
            this.applyKeyBinding(action, isSecondary, code, element);
            this.recording = null;
        }
    }

    private findConflict(code: string): { action: string, description: string, isSecondary: boolean } | null {
        const bindings = ConfigManager.getInstance().getSchema()['Keybindings'];
        for (const [action, item] of Object.entries(bindings)) {
            if (item.value === code) return { action, description: item.description, isSecondary: false };
            // @ts-ignore
            if (item.secondary === code) return { action, description: item.description, isSecondary: true };
        }
        return null;
    }

    private applyKeyBinding(action: string, isSecondary: boolean, code: string, element: HTMLElement): void {
        const config = ConfigManager.getInstance();
        const bindings = config.getSchema()['Keybindings'];

        // Clear this key from wherever else it might be
        for (const [act, item] of Object.entries(bindings)) {
            if (item.value === code) {
                item.value = '---';
            }
            // @ts-ignore
            if (item.secondary === code) {
                item.secondary = '---';
            }
        }

        const target = bindings[action];
        if (isSecondary) {
            // @ts-ignore
            target.secondary = code;
        } else {
            target.value = code;
        }

        element.textContent = code;
        element.classList.remove('recording');
        element.classList.remove('empty');
        EventBus.getInstance().emit(GameEvent.UI_CLICK, {});

        // Refresh UI to show cleared conflicts if any
        if (this.currentTab === 'Keybindings') {
            const content = this.container?.querySelector('.settings-content') as HTMLElement;
            if (content) this.renderKeybindings(content);
        }
    }

    private showConflictModal(code: string, conflictAction: string, conflictDesc: string, onConfirm: () => void): void {
        const uiLayer = document.getElementById('ui-layer');
        if (!uiLayer) return;

        this.modalOverlay = document.createElement('div');
        this.modalOverlay.className = 'settings-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'settings-modal';
        modal.innerHTML = `
          <h4>BINDING CONFLICT</h4>
          <p>Key <strong>${code}</strong> is already assigned to:<br>
          <span style="color: var(--steam-gold)">${conflictDesc}</span></p>
          <p>Do you want to reassign it?</p>
          <div class="modal-actions">
              <button class="confirm" id="modal-confirm">REASSIGN</button>
              <button class="cancel" id="modal-cancel">CANCEL</button>
          </div>
      `;

        this.modalOverlay.appendChild(modal);
        uiLayer.appendChild(this.modalOverlay);

        const confirmBtn = modal.querySelector('#modal-confirm') as HTMLButtonElement;
        const cancelBtn = modal.querySelector('#modal-cancel') as HTMLButtonElement;

        const cleanup = () => {
            this.closeModal();
        };

        confirmBtn.onclick = () => {
            EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
            onConfirm();
            cleanup();
        };

        cancelBtn.onclick = () => {
            EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
            this.cancelRecording();
            cleanup();
        };

        // Modal key listener (Enter/Esc)
        const modalKeyHandler = (e: KeyboardEvent) => {
            if (e.code === 'Enter') {
                confirmBtn.click();
                window.removeEventListener('keydown', modalKeyHandler);
            } else if (e.code === 'Escape') {
                cancelBtn.click();
                window.removeEventListener('keydown', modalKeyHandler);
            }
        };
        window.addEventListener('keydown', modalKeyHandler);
    }

    private closeModal(): void {
        if (this.modalOverlay) {
            this.modalOverlay.remove();
            this.modalOverlay = null;
        }
    }

    private applySetting(category: string, key: string, value: any): void {
        ConfigManager.getInstance().set(category, key, value);

        // Notify systems that need immediate refresh
        if (category === 'Weather') {
            WeatherManager.getInstance().refreshConfig();
        } else if (category === 'TimeSystem') {
            WorldClock.getInstance().reset(); // Re-read start hour etc if changed? Or just let it be.
            // Actually, reset() on WorldClock re-reads startHour.
        } else if (category === 'Audio' && key === 'masterVolume') {
            SoundManager.getInstance().setVolume(value);
        }
        // Note: Keybindings are handled by InputManager which reads config on update or next scene enter.
    }

    private generateColorPalette(): string[] {
        const colors: string[] = [];
        const steps = [0x00, 0x55, 0xAA, 0xFF];
        for (let r of steps) {
            for (let g of steps) {
                for (let b of steps) {
                    const hex = '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
                    colors.push(hex);
                }
            }
        }
        return colors;
    }
}