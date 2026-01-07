import { Scene } from '../core/Scene';
import { SceneManager } from '../core/SceneManager';
import { SoundManager } from '../core/SoundManager';
import { EventBus, GameEvent } from '../core/EventBus';

export class MainMenuScene implements Scene {
  private container: HTMLDivElement | null = null;

  constructor(private sceneManager: SceneManager) {}

  onEnter(): void {
    console.log('Entering Main Menu');
    this.createUI();
    // Init sound on first interaction
    SoundManager.getInstance().init();
  }

  onExit(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }

  update(dt: number): void {
    // Background animations could go here
  }

  render(ctx: CanvasRenderingContext2D): void {
    // Draw fancy background on canvas
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    // Grid effect
    ctx.strokeStyle = '#003300';
    ctx.lineWidth = 1;
    const spacing = 50;
    
    for(let x = 0; x < ctx.canvas.width; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ctx.canvas.height);
      ctx.stroke();
    }
    
    for(let y = 0; y < ctx.canvas.height; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ctx.canvas.width, y);
      ctx.stroke();
    }
  }

  private createUI(): void {
    const uiLayer = document.getElementById('ui-layer');
    if (!uiLayer) return;

    this.container = document.createElement('div');
    this.container.className = 'ui-panel';
    
    // Mute Icon State
    const isMuted = SoundManager.getInstance().getMuted();
    const muteIcon = isMuted ? '🔇' : '🔊';

    this.container.innerHTML = `
      <h1 style="color: #00ff00; text-align: center; font-size: 2em; margin-bottom: 30px;">NEON ROGUE</h1>
      <button id="btn-start">Start Game</button>
      <button id="btn-multiplayer">Multiplayer</button>
      <button id="btn-benchmark">Run Benchmark</button>
      <button id="btn-settings">Settings</button>
    `;

    uiLayer.appendChild(this.container);

    document.getElementById('btn-start')?.addEventListener('click', () => {
      EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
      this.sceneManager.switchScene('gameplay');
    });

    document.getElementById('btn-multiplayer')?.addEventListener('click', () => {
        EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
        this.sceneManager.switchScene('multiplayer_menu');
    });

    document.getElementById('btn-benchmark')?.addEventListener('click', () => {
      EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
      this.sceneManager.switchScene('benchmark');
    });

    document.getElementById('btn-settings')?.addEventListener('click', () => {
      EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
      this.sceneManager.switchScene('settings');
    });
  }
}
