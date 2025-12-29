import { ConfigManager } from '../config/MasterConfig';

export class World {
  private width: number;
  private height: number;
  private tileSize: number;
  private tiles: number[][]; // 0 = empty, 1 = obstacle

  constructor() {
    this.width = ConfigManager.getInstance().get('World', 'width');
    this.height = ConfigManager.getInstance().get('World', 'height');
    this.tileSize = ConfigManager.getInstance().get('World', 'tileSize');
    this.tiles = [];

    this.generate();
  }

  private generate(): void {
    // Initialize empty grid
    for (let y = 0; y < this.height; y++) {
      const row: number[] = [];
      for (let x = 0; x < this.width; x++) {
        // Border walls
        if (x === 0 || x === this.width - 1 || y === 0 || y === this.height - 1) {
          row.push(1);
        } else {
            // Random obstacles
            row.push(Math.random() < 0.05 ? 1 : 0);
        }
      }
      this.tiles.push(row);
    }
  }

  public getWidthPixels(): number {
    return this.width * this.tileSize;
  }

  public getHeightPixels(): number {
    return this.height * this.tileSize;
  }

  public render(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number): void {
    const viewWidth = ctx.canvas.width;
    const viewHeight = ctx.canvas.height;
    
    // Calculate visible tile range
    const startCol = Math.floor(cameraX / this.tileSize);
    const endCol = startCol + (viewWidth / this.tileSize) + 1;
    const startRow = Math.floor(cameraY / this.tileSize);
    const endRow = startRow + (viewHeight / this.tileSize) + 1;

    // Draw Grid Background (Sepia/Blueprint style)
    ctx.strokeStyle = '#2c241b'; // Very dark brown lines
    ctx.lineWidth = 1;

    for (let y = startRow; y <= endRow; y++) {
      if (y < 0 || y >= this.height) continue;
      
      for (let x = startCol; x <= endCol; x++) {
        if (x < 0 || x >= this.width) continue;

        const tileType = this.tiles[y][x];
        const worldX = x * this.tileSize;
        const worldY = y * this.tileSize;

        if (tileType === 1) {
          // Industrial Wall Look
          ctx.fillStyle = '#2a2a2a'; // Iron dark grey
          ctx.fillRect(worldX, worldY, this.tileSize, this.tileSize);
          
          // Rivet border
          ctx.strokeStyle = '#554433'; // Rusted edge
          ctx.lineWidth = 2;
          ctx.strokeRect(worldX + 2, worldY + 2, this.tileSize - 4, this.tileSize - 4);
          
          // Cross brace
          ctx.beginPath();
          ctx.moveTo(worldX, worldY);
          ctx.lineTo(worldX + this.tileSize, worldY + this.tileSize);
          ctx.stroke();
        }
      }
    }
  }

  // --- Collision Helpers ---

  public isWall(x: number, y: number): boolean {
    // Convert world coords to grid coords
    const gx = Math.floor(x / this.tileSize);
    const gy = Math.floor(y / this.tileSize);
    
    // Check bounds
    if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) {
      return true; // Outside world is a wall
    }

    return this.tiles[gy][gx] === 1;
  }

  public resolveCollision(x: number, y: number, radius: number): { x: number, y: number, collided: boolean } {
    // Simple resolution: If inside wall, push back?
    // Better: Check future position.
    
    // But for this method, we just check if (x,y) is valid.
    if (this.isWall(x, y)) return { x, y, collided: true };
    
    // Check circle vs tile edges is harder.
    // Simplified: Check center point.
    // Even better: Check 4 points around circle.
    
    return { x, y, collided: false };
  }
}
