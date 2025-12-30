import { ConfigManager } from '../config/MasterConfig';
import { MaterialType } from './HeatMap';

export class World {
  private width: number;
  private height: number;
  private tileSize: number;
  private tiles: MaterialType[][]; // Material of the tile
  private heatMapRef: any = null;

  // Optimized Shadow Geometry
  private cachedSegments: {a: {x: number, y: number}, b: {x: number, y: number}}[] = [];
  private isMeshDirty: boolean = true;

  constructor() {
    this.width = ConfigManager.getInstance().get('World', 'width');
    this.height = ConfigManager.getInstance().get('World', 'height');
    this.tileSize = ConfigManager.getInstance().get('World', 'tileSize');
    this.tiles = [];

    this.generate();
  }

  public setHeatMap(hm: any): void {
      this.heatMapRef = hm;
      this.heatMapRef.setWorldRef(this);
      // Initialize HeatMap materials from world
      for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
              if (this.tiles[y][x] !== MaterialType.NONE) {
                  this.heatMapRef.setMaterial(x, y, this.tiles[y][x]);
              }
          }
      }
  }

  public markMeshDirty(): void {
      this.isMeshDirty = true;
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
              const subDiv = 10;
              const subSize = this.tileSize / subDiv;
              const hasData = this.heatMapRef && this.heatMapRef.hasTileData(x, y);

              if (hasData) {
                  // Damaged tile: Draw both side and top sub-tile by sub-tile
                  for (let sy = 0; sy < subDiv; sy++) {
                      for (let sx = 0; sx < subDiv; sx++) {
                          const subWorldX = worldX + sx * subSize;
                          const subWorldY = worldY + sy * subSize;
                          
                          if (!this.heatMapRef.isSubTileDestroyed(subWorldX + subSize/2, subWorldY + subSize/2)) {
                              // Side shadow
                              ctx.fillStyle = sideColor;
                              ctx.fillRect(subWorldX, subWorldY, subSize + 0.2, subSize + 0.2);
                              
                              // Top face
                              ctx.fillStyle = color;
                              ctx.fillRect(subWorldX, subWorldY - h, subSize + 0.2, subSize + 0.2);
                              
                              // Optional: Small top highlight for each sub-tile edge
                              if (sy === 0 || sx === 0) {
                                  ctx.fillStyle = topColor;
                                  if (sy === 0) ctx.fillRect(subWorldX, subWorldY - h, subSize, 1);
                                  if (sx === 0) ctx.fillRect(subWorldX, subWorldY - h, 1, subSize);
                              }
                          }
                      }
                  }
              } else {
                  // Healthy tile: Fast path draw big rects
                  ctx.fillStyle = sideColor;
                  ctx.fillRect(worldX, worldY, this.tileSize, this.tileSize);
                  ctx.fillStyle = color;
                  ctx.fillRect(worldX, worldY - h, this.tileSize, this.tileSize);
                  ctx.fillStyle = topColor;
                  ctx.fillRect(worldX, worldY - h, this.tileSize, 2);
                  ctx.fillRect(worldX, worldY - h, 2, this.tileSize);
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

  private rebuildMesh(): void {
      const segments: {a: {x: number, y: number}, b: {x: number, y: number}}[] = [];
      const ts = this.tileSize;

      // 1. Process Healthy Tiles (Greedy horizontal merging)
      const visitedH = new Set<string>();
      for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
              if (this.tiles[y][x] === MaterialType.NONE || visitedH.has(`${x},${y}`)) continue;
              if (this.heatMapRef && this.heatMapRef.hasTileData(x, y)) continue; 

              let xEnd = x;
              while (xEnd + 1 < this.width && 
                     this.tiles[y][xEnd + 1] !== MaterialType.NONE && 
                     !(this.heatMapRef && this.heatMapRef.hasTileData(xEnd + 1, y))) {
                  xEnd++;
                  visitedH.add(`${xEnd},${y}`);
              }

              const x1 = x * ts;
              const x2 = (xEnd + 1) * ts;
              const y1 = y * ts;
              const y2 = (y + 1) * ts;

              if (y === 0 || this.tiles[y-1][x] === MaterialType.NONE)
                  segments.push({a: {x: x1, y: y1}, b: {x: x2, y: y1}});
              if (y === this.height - 1 || this.tiles[y+1][x] === MaterialType.NONE)
                  segments.push({a: {x: x1, y: y2}, b: {x: x2, y: y2}});
              
              segments.push({a: {x: x1, y: y1}, b: {x: x1, y: y2}});
              segments.push({a: {x: x2, y: y1}, b: {x: x2, y: y2}});
          }
      }

      // 2. Process Damaged Tiles (Intra-tile edge merging)
      for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
              if (this.tiles[y][x] === MaterialType.NONE) continue;
              const hData = this.heatMapRef ? this.heatMapRef.getTileHP(x, y) : null;
              if (!hData) continue;

              const subDiv = 10;
              const ss = ts / subDiv;
              const wx = x * ts;
              const wy = y * ts;

              for (let sy = 0; sy <= subDiv; sy++) {
                  let startX: number | null = null;
                  for (let sx = 0; sx < subDiv; sx++) {
                      const idx = sy * subDiv + sx;
                      const idxAbove = (sy - 1) * subDiv + sx;
                      const needsEdge = (sy === 0 && hData[idx] > 0) ||
                                      (sy === subDiv && hData[idxAbove] > 0) ||
                                      (sy > 0 && sy < subDiv && (hData[idx] > 0) !== (hData[idxAbove] > 0));
                      if (needsEdge) { if (startX === null) startX = sx; } 
                      else { if (startX !== null) {
                          segments.push({a: {x: wx + startX * ss, y: wy + sy * ss}, b: {x: wx + sx * ss, y: wy + sy * ss}});
                          startX = null;
                      }}
                  }
                  if (startX !== null) segments.push({a: {x: wx + startX * ss, y: wy + sy * ss}, b: {x: wx + ts, y: wy + sy * ss}});
              }

              for (let sx = 0; sx <= subDiv; sx++) {
                  let startY: number | null = null;
                  for (let sy = 0; sy < subDiv; sy++) {
                      const idx = sy * subDiv + sx;
                      const idxLeft = sy * subDiv + (sx - 1);
                      const needsEdge = (sx === 0 && hData[idx] > 0) ||
                                      (sx === subDiv && hData[idxLeft] > 0) ||
                                      (sx > 0 && sx < subDiv && (hData[idx] > 0) !== (hData[idxLeft] > 0));
                      if (needsEdge) { if (startY === null) startY = sy; }
                      else { if (startY !== null) {
                          segments.push({a: {x: wx + sx * ss, y: wy + startY * ss}, b: {x: wx + sx * ss, y: wy + sy * ss}});
                          startY = null;
                      }}
                  }
                  if (startY !== null) segments.push({a: {x: wx + sx * ss, y: wy + startY * ss}, b: {x: wx + sx * ss, y: wy + ts}});
              }
          }
      }

      this.cachedSegments = segments;
      this.isMeshDirty = false;
  }

  public getOcclusionSegments(cameraX: number, cameraY: number, viewWidth: number, viewHeight: number): {a: {x: number, y: number}, b: {x: number, y: number}}[] {
      if (this.isMeshDirty) {
          this.rebuildMesh();
      }

      const padding = 200;
      return this.cachedSegments.filter(s => {
          return (s.a.x > cameraX - padding && s.a.x < cameraX + viewWidth + padding &&
                  s.a.y > cameraY - padding && s.a.y < cameraY + viewHeight + padding) ||
                 (s.b.x > cameraX - padding && s.b.x < cameraX + viewWidth + padding &&
                  s.b.y > cameraY - padding && s.b.y < cameraY + viewHeight + padding);
      });
  }
}
