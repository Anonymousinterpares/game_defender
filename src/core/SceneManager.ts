import { Scene } from './Scene';
import { MainMenuScene } from '../ui/MainMenuScene';
import { SettingsScene } from '../ui/SettingsScene';
import { GameplayScene } from './GameplayScene';
import { InputManager } from './InputManager';

export class SceneManager {
  private scenes: Map<string, Scene> = new Map();
  private currentScene: Scene | null = null;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private uiLayer: HTMLElement,
    private inputManager: InputManager
  ) {
    // Register Scenes
    this.scenes.set('menu', new MainMenuScene(this));
    this.scenes.set('settings', new SettingsScene(this));
    this.scenes.set('gameplay', new GameplayScene(this, inputManager));

    // Start with Menu
    this.switchScene('menu');
  }

  public switchScene(name: string): void {
    if (this.currentScene) {
      this.currentScene.onExit();
    }

    const nextScene = this.scenes.get(name);
    if (nextScene) {
      this.currentScene = nextScene;
      this.currentScene.onEnter();
    } else {
      console.error(`Scene ${name} not found!`);
    }
  }

  public getCurrentScene(): Scene | null {
    return this.currentScene;
  }

  public update(dt: number): void {
    if (this.currentScene) {
      this.currentScene.update(dt);
    }
  }

  public render(): void {
    if (this.currentScene) {
      this.currentScene.render(this.ctx);
    }
  }
}
