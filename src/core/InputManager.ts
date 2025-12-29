export class InputManager {
  private keys: Set<string> = new Set();
  private prevKeys: Set<string> = new Set();
  
  // Directions (calculated from WASD/Arrows)
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
      // Create a snapshot of keys for "JustPressed" logic
      // Actually, standard way is:
      // update() is called at start of frame.
      // We copy keys to prevKeys.
      // But events happen async.
      // Better: maintain prevKeys manually.
      this.prevKeys = new Set(this.keys);
  }

  private onMouseMove(e: MouseEvent): void {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.keys.add(e.code);
    this.updateDirection();
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
    this.updateDirection();
  }

  private updateDirection(): void {
    this.x = 0;
    this.y = 0;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.x += 1;
  }

  public isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }
  
  public isKeyJustPressed(code: string): boolean {
      // This is hard without an explicit update() loop call from Game.ts
      // Assuming user calls update() on input manager
      return this.keys.has(code) && !this.prevKeys.has(code);
  }
}
