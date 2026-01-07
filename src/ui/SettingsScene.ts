import { Scene } from '../core/Scene';
import { SceneManager } from '../core/SceneManager';
import { ConfigManager, ConfigItem } from '../config/MasterConfig';
import { SoundManager } from '../core/SoundManager';
import { InputManager } from '../core/InputManager';
import { WeatherManager, WeatherType } from '../core/WeatherManager';

export class SettingsScene implements Scene {
  private container: HTMLDivElement | null = null;
  private currentTab: string = 'World';

  constructor(
    private sceneManager: SceneManager,
    private inputManager: InputManager
  ) {}

  onEnter(): void {
    this.createUI();
  }

  onExit(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }

  update(dt: number): void {
    if (this.inputManager.isKeyJustPressed('Escape')) {
      this.sceneManager.switchScene('menu');
    }
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
    closeBtn.onclick = () => {
        SoundManager.getInstance().playSound('ui_click');
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
    const categories = [...Object.keys(schema), 'Keybindings'];

    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.textContent = cat;
        btn.className = `tab-btn ${cat === this.currentTab ? 'active' : ''}`;
        
        btn.onclick = () => {
            SoundManager.getInstance().playSound('ui_click');
            this.currentTab = cat;
            
            // Update active states
            sidebar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            this.renderTabContent(content, cat);
        };
        
        sidebar.appendChild(btn);
    });

    // Initial render
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

      // --- Number Input (Range) ---
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
      } 
      // --- Boolean Input (Checkbox) ---
      else if (item.type === 'boolean') {
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = item.value as boolean;
          
          checkbox.addEventListener('change', (e) => {
              const val = (e.target as HTMLInputElement).checked;
              this.applySetting(category, key, val);
          });
          wrapper.appendChild(checkbox);
      }
      // --- Dropdown (Options) ---
      else if (item.options && item.options.length > 0) {
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
      }
      // --- Color Input ---
      else if (item.type === 'color') {
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
              swatch.title = color;
              swatch.onclick = () => {
                  picker.value = color;
                  this.applySetting(category, key, color);
                  SoundManager.getInstance().playSound('ui_click');
              };
              palette.appendChild(swatch);
          });

          container.appendChild(palette);
          wrapper.appendChild(container);
      }
      // --- Complex Object / Read-only ---
      else if (item.type === 'object') {
           const info = document.createElement('div');
           info.style.cssText = `
             background: rgba(0,0,0,0.3);
             padding: 15px;
             font-size: 0.85em;
             color: #888;
             border: 1px dashed var(--steam-iron);
             white-space: pre-wrap;
             font-family: monospace;
             line-height: 1.4;
           `;
           info.textContent = JSON.stringify(item.value, null, 2);
           wrapper.appendChild(info);
      }
      // --- Fallback String Input ---
      else {
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
      const bindings = [
          { label: 'Move Forward', key: 'KeyW' },
          { label: 'Move Backward', key: 'KeyS' },
          { label: 'Turn Left', key: 'KeyA' },
          { label: 'Turn Right', key: 'KeyD' },
          { label: 'Fire Primary', key: 'Space' },
          { label: 'Open Shop', key: 'KeyP' },
          { label: 'Main Menu', key: 'Escape' }
      ];

      bindings.forEach(b => {
          const row = document.createElement('div');
          row.className = 'keybinding-row';
          
          const label = document.createElement('span');
          label.className = 'key-label';
          label.textContent = b.label;
          
          const val = document.createElement('span');
          val.className = 'key-value';
          val.textContent = b.key;
          val.onclick = () => {
              val.textContent = '...PRESS KEY...';
              val.classList.add('recording');
              // Note: Implementation of actual rebinding requires InputManager support
              setTimeout(() => {
                  val.textContent = b.key;
                  val.classList.remove('recording');
              }, 2000);
          };

          row.appendChild(label);
          row.appendChild(val);
          container.appendChild(row);
      });
  }

  private applySetting(category: string, key: string, value: any): void {
      ConfigManager.getInstance().set(category, key, value);
      
      if (category === 'Weather' && key === 'initialWeather') {
         WeatherManager.getInstance().setWeather(value as WeatherType, false);
      }
  }

  private generateColorPalette(): string[] {
    const colors: string[] = [];
    const steps = [0x00, 0x55, 0xAA, 0xFF];
    for (let r of steps) {
        for (let g of steps) {
            for (let b of steps) {
                const hex = '#' + 
                    r.toString(16).padStart(2,'0') + 
                    g.toString(16).padStart(2,'0') + 
                    b.toString(16).padStart(2,'0');
                colors.push(hex);
            }
        }
    }
    return colors;
  }
}
