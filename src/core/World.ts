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
    
    for (let y = 0; y < this.height; y++) {
      const row: MaterialType[] = [];
      for (let x = 0; x < this.width; x++) {
        // Border walls
        if (x === 0 || x === this.width - 1 || y === 0 || y === this.height - 1) {
          row.push(MaterialType.INDESTRUCTIBLE);
        } else {
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
    
    // 1. Render Infinite Charcoal Void & Structural Grid
    ctx.fillStyle = '#111111'; // Charcoal substrate
    ctx.fillRect(cameraX, cameraY, viewWidth, viewHeight);

    ctx.beginPath();
    ctx.strokeStyle = '#1a1a1a'; // Dark grid lines
    ctx.lineWidth = 1;

    const startX = Math.floor(cameraX / this.tileSize) * this.tileSize;
    const endX = cameraX + viewWidth;
    const startY = Math.floor(cameraY / this.tileSize) * this.tileSize;
    const endY = cameraY + viewHeight;

    for (let x = startX; x <= endX; x += this.tileSize) {
        ctx.moveTo(x, cameraY);
        ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += this.tileSize) {
        ctx.moveTo(cameraX, y);
        ctx.lineTo(endX, y);
    }
    ctx.stroke();

    // 2. Render Walls (Casters)
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
          let color = '#2a2a2a';
          let sideColor = '#1a1a1a';
          let topColor = '#444';
          
          switch(tileType) {
              case MaterialType.WOOD: color = '#5d4037'; sideColor = '#3e2723'; topColor = '#795548'; break;
              case MaterialType.BRICK: color = '#a52a2a'; sideColor = '#800000'; topColor = '#c62828'; break;
              case MaterialType.STONE: color = '#616161'; sideColor = '#424242'; topColor = '#9e9e9e'; break;
              case MaterialType.METAL: color = '#37474f'; sideColor = '#263238'; topColor = '#546e7a'; break;
              case MaterialType.INDESTRUCTIBLE: color = '#1a1a1a'; sideColor = '#000000'; topColor = '#333333'; break;
          }

          const isMostlyDestroyed = this.heatMapRef ? this.heatMapRef.isTileMostlyDestroyed(x, y) : false;
          
          if (!isMostlyDestroyed) {
              const h = 8;
              ctx.fillStyle = sideColor;
              ctx.fillRect(worldX, worldY, this.tileSize, this.tileSize);
              ctx.fillStyle = color;
              ctx.fillRect(worldX, worldY - h, this.tileSize, this.tileSize);
              ctx.fillStyle = topColor;
              ctx.fillRect(worldX, worldY - h, this.tileSize, 2);
              ctx.fillRect(worldX, worldY - h, 2, this.tileSize);

              if (this.heatMapRef && this.heatMapRef.hasTileData(x, y)) {
                  const subDiv = 10;
                  const subSize = this.tileSize / subDiv;
                  ctx.save();
                  ctx.globalCompositeOperation = 'destination-out';
                  for (let sy = 0; sy < subDiv; sy++) {
                      for (let sx = 0; sx < subDiv; sx++) {
                          if (this.heatMapRef.isSubTileDestroyed(worldX + sx * subSize + subSize/2, worldY + sy * subSize + subSize/2)) {
                              ctx.fillRect(worldX + sx * subSize, worldY - h + sy * subSize, subSize, subSize);
                          }
                      }
                  }
                  ctx.restore();
              }
          } else {
              const subDiv = 10;
              const subSize = this.tileSize / subDiv;
              ctx.fillStyle = sideColor;
              for (let i = 0; i < 100; i++) {
                  const sx = i % subDiv;
                  const sy = Math.floor(i / subDiv);
                  if (!this.heatMapRef.isSubTileDestroyed(worldX + sx * subSize + subSize/2, worldY + sy * subSize + subSize/2)) {
                      ctx.fillRect(worldX + sx * subSize, worldY + sy * subSize, subSize + 0.5, subSize + 0.5);
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

  public getOcclusionSegments(cameraX: number, cameraY: number, viewWidth: number, viewHeight: number): {a: {x: number, y: number}, b: {x: number, y: number}}[] {
      const segments: {a: {x: number, y: number}, b: {x: number, y: number}}[] = [];
      
      const padding = this.tileSize * 2;
      const startCol = Math.floor((cameraX - padding) / this.tileSize);
      const endCol = Math.floor((cameraX + viewWidth + padding) / this.tileSize);
      const startRow = Math.floor((cameraY - padding) / this.tileSize);
      const endRow = Math.floor((cameraY + viewHeight + padding) / this.tileSize);

      for (let y = startRow; y <= endRow; y++) {
          if (y < 0 || y >= this.height) continue;
          for (let x = startCol; x <= endCol; x++) {
              if (x < 0 || x >= this.width) continue;

              const tileType = this.tiles[y][x];
              if (tileType !== MaterialType.NONE) {
                  const wx = x * this.tileSize;
                  const wy = y * this.tileSize;
                  const ts = this.tileSize;
                  
                  // For simplicity, we only add segments if the tile is NOT fully destroyed
                  // A better way would be per sub-tile, but that's very expensive for raycasting.
                  // We'll treat the whole tile as a shadow blocker if it's mostly there.
                  if (this.heatMapRef && this.heatMapRef.isTileMostlyDestroyed(x, y)) {
                      continue;
                  }

                  // Add 4 segments of the tile
                  segments.push({a: {x: wx, y: wy}, b: {x: wx + ts, y: wy}});
                  segments.push({a: {x: wx + ts, y: wy}, b: {x: wx + ts, y: wy + ts}});
                  segments.push({a: {x: wx + ts, y: wy + ts}, b: {x: wx, y: wy + ts}});
                  segments.push({a: {x: wx, y: wy + ts}, b: {x: wx, y: wy}});
              }
          }
      }
      return segments;
  }
}
