import '../styles/main.scss';
import { ConfigManager } from '../config/MasterConfig';
import { SceneManager } from './SceneManager';
import { InputManager } from './InputManager';
import { DevConsole } from './DevConsole';
import { WeatherManager } from './WeatherManager';

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private lastTime: number = 0;
  private sceneManager: SceneManager;
  private inputManager: InputManager;
  private devConsole: DevConsole;
  private fps: number = 0;
  private fpsUpdateTimer: number = 0;
  private frameCount: number = 0;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Container ${containerId} not found`);

    // Create Canvas
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    container.appendChild(this.canvas);

    // Create UI Layer
    const uiLayer = document.createElement('div');
    uiLayer.id = 'ui-layer';
    container.appendChild(uiLayer);

    // Init Managers
    this.inputManager = new InputManager();
    this.sceneManager = new SceneManager(this.ctx, uiLayer, this.inputManager);
    this.devConsole = new DevConsole(this.sceneManager);

    // Resize handling
    window.addEventListener('resize', () => this.resize());
    this.resize();

    // Start Loop
    requestAnimationFrame((ts) => this.loop(ts));
  }

  private resize(): void {
    // Fill the screen, or respect config? 
    // For now, full screen canvas, but game logical view might be different.
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    
    // Update config if needed or notify scenes
    // ConfigManager.getInstance().set('World', 'screenWidth', this.canvas.width);
  }

  private loop(timestamp: number): void {
    const deltaTime = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;

    this.frameCount++;
    this.fpsUpdateTimer += deltaTime;
    if (this.fpsUpdateTimer >= 0.5) {
        this.fps = Math.round(this.frameCount / this.fpsUpdateTimer);
        this.frameCount = 0;
        this.fpsUpdateTimer = 0;
    }

    this.update(deltaTime);
    this.render();

    requestAnimationFrame((ts) => this.loop(ts));
  }

  private update(dt: number): void {
    WeatherManager.getInstance().update(dt);
    this.sceneManager.update(dt);
    this.inputManager.update();
  }

  private render(): void {
    // Clear screen
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.sceneManager.render();

    // Render FPS if enabled
    if (ConfigManager.getInstance().get<boolean>('Debug', 'FpsShow')) {
        this.ctx.fillStyle = '#0f0';
        this.ctx.font = 'bold 14px "Share Tech Mono", monospace';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`FPS: ${this.fps}`, 10, this.canvas.height - 10);
    }
  }
}
