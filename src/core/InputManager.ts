import { ConfigManager } from '../config/MasterConfig';

export class InputManager {
  private keys: Set<string> = new Set();
  private prevKeys: Set<string> = new Set();

  // Directions (calculated from bindings)
  public x: number = 0;
  public y: number = 0;

  // Mouse
  public mouseX: number = 0;
  public mouseY: number = 0;

  constructor() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
  }

  public update(): void {
    this.prevKeys = new Set(this.keys);
  }

  private onMouseMove(e: MouseEvent): void {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
      return;
    }
    this.keys.add(e.code);
    this.updateDirection();
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
    this.updateDirection();
  }

  public updateDirection(): void {
    this.x = 0;
    this.y = 0;

    const config = ConfigManager.getInstance();

    if (this.isActionDown('moveUp')) this.y -= 1;
    if (this.isActionDown('moveDown')) this.y += 1;
    if (this.isActionDown('moveLeft')) this.x -= 1;
    if (this.isActionDown('moveRight')) this.x += 1;
  }

  public isActionDown(action: string): boolean {
    const binding = ConfigManager.getInstance().getSchema()['Keybindings'][action];
    if (!binding) return false;

    // Check primary
    if (this.keys.has(binding.value)) return true;

    // Check secondary if exists
    // @ts-ignore
    if (binding.secondary && this.keys.has(binding.secondary)) return true;

    return false;
  }

  public isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  public isKeyJustPressed(code: string): boolean {
    return this.keys.has(code) && !this.prevKeys.has(code);
  }

  /**
   * Used for rebinding UI to capture the next key press
   */
  public getAnyKeyDown(): string | null {
    if (this.keys.size > 0) {
      return Array.from(this.keys)[0];
    }
    return null;
  }

  public reset(): void {
    this.keys.clear();
    this.prevKeys.clear();
    this.x = 0;
    this.y = 0;
  }
}