import { ConfigManager } from '../config/MasterConfig';
import { MaterialType } from './HeatMap';

export class World {
  private width: number;
  private height: number;
  private tileSize: number;
  private tiles: MaterialType[][]; // Material of the tile
  private heatMapRef: any = null;

  constructor() {
    this.width = ConfigManager.getInstance().get('World', 'width');
    this.height = ConfigManager.getInstance().get('World', 'height');
    this.tileSize = ConfigManager.getInstance().get('World', 'tileSize');
    this.tiles = [];

    this.generate();
  }

  public setHeatMap(hm: any): void {
      this.heatMapRef = hm;
      // Initialize HeatMap materials from world
      for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
              if (this.tiles[y][x] !== MaterialType.NONE) {
                  this.heatMapRef.setMaterial(x, y, this.tiles[y][x]);
              }
          }
      }
  }

  private generate(): void {
    const materials = [MaterialType.WOOD, MaterialType.BRICK, MaterialType.STONE, MaterialType.METAL];
    
    // Initialize empty grid
    for (let y = 0; y < this.height; y++) {
      const row: MaterialType[] = [];
      for (let x = 0; x < this.width; x++) {
        // Border walls
        if (x === 0 || x === this.width - 1 || y === 0 || y === this.height - 1) {
          row.push(MaterialType.INDESTRUCTIBLE);
        } else {
            // Random obstacles
            if (Math.random() < 0.05) {
                const mat = materials[Math.floor(Math.random() * materials.length)];
                row.push(mat);
            } else {
                row.push(MaterialType.NONE);
            }
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

    for (let y = startRow; y <= endRow; y++) {
      if (y < 0 || y >= this.height) continue;
      
      for (let x = startCol; x <= endCol; x++) {
        if (x < 0 || x >= this.width) continue;

        const tileType = this.tiles[y][x];
        const worldX = x * this.tileSize;
        const worldY = y * this.tileSize;

        if (tileType !== MaterialType.NONE) {
          // Choose color based on material
          let color = '#2a2a2a';
          let borderColor = '#554433';
          
          switch(tileType) {
              case MaterialType.WOOD: color = '#5d4037'; borderColor = '#3e2723'; break;
              case MaterialType.BRICK: color = '#a52a2a'; borderColor = '#800000'; break;
              case MaterialType.STONE: color = '#616161'; borderColor = '#424242'; break;
              case MaterialType.METAL: color = '#37474f'; borderColor = '#263238'; break;
              case MaterialType.INDESTRUCTIBLE: color = '#1a1a1a'; borderColor = '#443322'; break;
          }

          const subDiv = 10;
          const subSize = this.tileSize / subDiv;

          for (let sy = 0; sy < subDiv; sy++) {
              for (let sx = 0; sx < subDiv; sx++) {
                  const subX = worldX + sx * subSize;
                  const subY = worldY + sy * subSize;

                  if (this.heatMapRef && this.heatMapRef.isSubTileDestroyed(subX + subSize/2, subY + subSize/2)) {
                      continue;
                  }

                  ctx.fillStyle = color;
                  ctx.fillRect(subX, subY, subSize + 0.5, subSize + 0.5);

                  // Optional: draw small details or borders only on edges
                  // For performance, we'll keep it simple: just the material color.
                  // But let's add the material details back in a simplified way.
                  if (tileType === MaterialType.WOOD && sx % 3 === 0) {
                      ctx.fillStyle = borderColor;
                      ctx.fillRect(subX, subY, 1, subSize);
                  }
                  if (tileType === MaterialType.METAL && sx === sy) {
                      ctx.fillStyle = borderColor;
                      ctx.fillRect(subX, subY, subSize, 1);
                  }
              }
          }
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

    if (this.tiles[gy][gx] === MaterialType.NONE) return false;
    
    // Check sub-tile destruction
    if (this.heatMapRef && this.heatMapRef.isSubTileDestroyed(x, y)) {
        return false;
    }

    return true;
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
