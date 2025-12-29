import { Scene } from '../core/Scene';
import { SceneManager } from '../core/SceneManager';
import { ConfigManager, ConfigItem } from '../config/MasterConfig';
import { SoundManager } from '../core/SoundManager';

export class SettingsScene implements Scene {
  private container: HTMLDivElement | null = null;

  constructor(private sceneManager: SceneManager) {}

  onEnter(): void {
    this.createUI();
  }

  onExit(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }

  update(dt: number): void {}
  render(ctx: CanvasRenderingContext2D): void {
     // Draw dimmed background
     ctx.fillStyle = 'rgba(0,0,0,0.5)';
     ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  private createUI(): void {
    const uiLayer = document.getElementById('ui-layer');
    if (!uiLayer) return;

    this.container = document.createElement('div');
    this.container.className = 'ui-panel';
    this.container.style.width = '600px';
    
    let html = `<h2>Settings</h2>`;

    // Instructions Block
    html += `
      <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--steam-brass); padding: 15px; margin-bottom: 20px; font-size: 0.8em; color: var(--steam-gold);">
        <h4 style="margin-top:0; text-decoration: underline;">OPERATIONAL CONTROLS:</h4>
        <ul style="list-style: none; padding: 0;">
            <li><b>MOUSE:</b> Aim / Steering Direction</li>
            <li><b>[W]:</b> Throttle Forward</li>
            <li><b>[S]:</b> Reverse Gear</li>
            <li><b>[SPACE]:</b> Fire Primary Cannon</li>
            <li><b>[P]:</b> Open Engineering Dock</li>
            <li><b>[ESC]:</b> Return to Main Menu</li>
        </ul>
      </div>
    `;

    // Difficulty Placeholder
    html += `
      <div class="control-group" style="border: 1px dashed #666; padding: 10px; margin-bottom: 20px;">
        <label>Game Difficulty (Coming Soon)</label>
        <select disabled style="width: 100%; background: #222; color: #666; border: 1px solid #444;">
          <option>Normal</option>
          <option>Hard</option>
          <option>Nightmare</option>
        </select>
      </div>
    `;
    
    const schema = ConfigManager.getInstance().getSchema();

    // Iterate categories
    for (const [categoryName, category] of Object.entries(schema)) {
      html += `<h3 style="color: var(--steam-brass); border-bottom: 1px solid #333; margin-top: 20px;">${categoryName}</h3>`;
      
      // Iterate items
      for (const [key, item] of Object.entries(category)) {
        html += this.generateControl(categoryName, key, item);
      }
    }

    html += `<button id="btn-back">BACK TO MENU</button>`;
    
    this.container.innerHTML = html;
    uiLayer.appendChild(this.container);

    // Bind events
    this.bindEvents(schema);

    document.getElementById('btn-back')?.addEventListener('click', () => {
      SoundManager.getInstance().playSound('ui_click');
      this.sceneManager.switchScene('menu');
    });
  }

  private generateControl(category: string, key: string, item: ConfigItem<any>): string {
    const uniqueId = `cfg-${category}-${key}`;
    
    if (item.type === 'number' && item.min !== undefined && item.max !== undefined) {
      return `
        <div class="control-group">
          <label for="${uniqueId}">${item.description}</label>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="range" id="${uniqueId}" min="${item.min}" max="${item.max}" step="${item.step || 1}" value="${item.value}">
            <span id="${uniqueId}-val" class="value-display">${item.value}</span>
          </div>
        </div>
      `;
    } else if (item.type === 'boolean') {
      return `
        <div class="control-group">
          <label style="display: flex; justify-content: space-between; align-items: center;">
            ${item.description}
            <input type="checkbox" id="${uniqueId}" ${item.value ? 'checked' : ''}>
          </label>
        </div>
      `;
    } else if (item.type === 'string') {
        return `
            <div class="control-group">
                <label for="${uniqueId}">${item.description}</label>
                <input type="text" id="${uniqueId}" value="${item.value}" style="background: #000; color: #0f0; border: 1px solid #333; padding: 5px;">
            </div>
        `;
    }
    return '';
  }

  private bindEvents(schema: any): void {
    for (const [categoryName, category] of Object.entries(schema)) {
      // @ts-ignore
      for (const [key, rawItem] of Object.entries(category)) {
        const item = rawItem as ConfigItem<any>;
        const uniqueId = `cfg-${categoryName}-${key}`;
        const el = document.getElementById(uniqueId) as HTMLInputElement;
        
        if (!el) continue;

        if (item.type === 'number') {
          const valDisplay = document.getElementById(`${uniqueId}-val`);
          el.addEventListener('input', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            ConfigManager.getInstance().set(categoryName, key, val);
            if (valDisplay) valDisplay.textContent = val.toString();
          });
          el.addEventListener('change', () => SoundManager.getInstance().playSound('ui_click'));
        } else if (item.type === 'boolean') {
          el.addEventListener('change', (e) => {
            SoundManager.getInstance().playSound('ui_click');
            const val = (e.target as HTMLInputElement).checked;
            ConfigManager.getInstance().set(categoryName, key, val);
          });
        } else if (item.type === 'string') {
            el.addEventListener('change', (e) => {
                SoundManager.getInstance().playSound('ui_click');
                const val = (e.target as HTMLInputElement).value;
                ConfigManager.getInstance().set(categoryName, key, val);
            });
        }
      }
    }
  }
}
