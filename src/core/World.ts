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
  private spatialGrid: Map<string, {a: {x: number, y: number}, b: {x: number, y: number}}[]> = new Map();
  private gridCellSize: number = 256;
  private isMeshDirty: boolean = true;
  private meshVersion: number = 0;

  // Render Caching
  private tileCanvasCache: Map<string, HTMLCanvasElement> = new Map();

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
      if (!this.isMeshDirty) {
          this.isMeshDirty = true;
          this.meshVersion++;
      }
  }

  public getMeshVersion(): number {
      return this.meshVersion;
  }

  public invalidateTileCache(tx: number, ty: number): void {
      this.tileCanvasCache.delete(`${tx},${ty}`);
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

  private renderTileToCache(tx: number, ty: number, tileType: MaterialType): HTMLCanvasElement {
      const canvas = document.createElement('canvas');
      canvas.width = this.tileSize;
      canvas.height = this.tileSize + 16; // Extra space for 3D height
      const ctx = canvas.getContext('2d')!;
      
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

      const h = 8;
      const subDiv = 10;
      const subSize = this.tileSize / subDiv;
      const hData = this.heatMapRef ? this.heatMapRef.getTileHP(tx, ty) : null;
      const heatData = this.heatMapRef ? this.heatMapRef.getTileHeat(tx, ty) : null;
      const sData = this.heatMapRef ? this.heatMapRef.getTileScorch(tx, ty) : null;

      if (hData) {
          for (let sy = 0; sy < subDiv; sy++) {
              for (let sx = 0; sx < subDiv; sx++) {
                  const idx = sy * subDiv + sx;
                  if (hData[idx] > 0) {
                      const lx = sx * subSize;
                      const ly = sy * subSize + h;
                      
                      // 1. Render Side & Top
                      ctx.fillStyle = sideColor;
                      ctx.fillRect(lx, ly, subSize, subSize);
                      ctx.fillStyle = color;
                      ctx.fillRect(lx, ly - h, subSize, subSize);
                      
                      // 2. Render Scorch Marks (Cached)
                      if (sData && sData[idx]) {
                          ctx.fillStyle = tileType === MaterialType.WOOD ? 'rgba(28, 28, 28, 0.8)' : 'rgba(0,0,0,0.5)';
                          ctx.fillRect(lx, ly - h, subSize, subSize);
                      }

                      // 3. Render Static Heat Glow (Low intensity heat bakes into cache)
                      if (heatData && heatData[idx] > 0.05) {
                          const heat = heatData[idx];
                          // Only bake if not "white hot" (animated heat stays in real-time)
                          if (heat < 0.6) {
                              const r = Math.floor(100 + 155 * (heat / 0.4));
                              ctx.fillStyle = `rgba(${r}, 0, 0, ${0.2 + heat * 0.4})`;
                              ctx.fillRect(lx, ly - h, subSize, subSize);
                          }
                      }

                      // 4. Highlights
                      if (sy === 0 || sx === 0) {
                          ctx.fillStyle = topColor;
                          if (sy === 0) ctx.fillRect(lx, ly - h, subSize, 1);
                          if (sx === 0) ctx.fillRect(lx, ly - h, 1, subSize);
                      }
                  }
              }
          }
      } else {
          ctx.fillStyle = sideColor;
          ctx.fillRect(0, h, this.tileSize, this.tileSize);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, this.tileSize, this.tileSize);
          ctx.fillStyle = topColor;
          ctx.fillRect(0, 0, this.tileSize, 2);
          ctx.fillRect(0, 0, 2, this.tileSize);
      }

      this.tileCanvasCache.set(`${tx},${ty}`, canvas);
      return canvas;
  }

  public render(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number): void {
      this.renderInternal(ctx, cameraX, cameraY, false);
  }

  public renderAsSilhouette(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, color: string): void {
      this.renderInternal(ctx, cameraX, cameraY, true, color);
  }

  private renderInternal(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, silhouette: boolean, silColor?: string): void {
    const viewWidth = ctx.canvas.width;
    const viewHeight = ctx.canvas.height;
    
    if (!silhouette) {
        // 1. Render Infinite Charcoal Void & Structural Grid
        ctx.fillStyle = '#111111';
        ctx.fillRect(cameraX, cameraY, viewWidth, viewHeight);

        // Render Ground/Floor color
        ctx.fillStyle = '#1c1c1c'; // Slightly lighter than the void to represent the floor
        const startX = Math.floor(cameraX / this.tileSize) * this.tileSize;
        const endX = cameraX + viewWidth;
        const startY = Math.floor(cameraY / this.tileSize) * this.tileSize;
        const endY = cameraY + viewHeight;
        
        ctx.fillRect(startX, startY, endX - startX, endY - startY);

        ctx.beginPath();
        ctx.strokeStyle = '#222222'; // Darker grid for subtle floor texture
        ctx.lineWidth = 1;

        for (let x = startX; x <= endX; x += this.tileSize) {
            ctx.moveTo(x, cameraY);
            ctx.lineTo(x, endY);
        }
        for (let y = startY; y <= endY; y += this.tileSize) {
            ctx.moveTo(cameraX, y);
            ctx.lineTo(endX, y);
        }
        ctx.stroke();
    }

    // 2. Render Walls
    const startCol = Math.floor(cameraX / this.tileSize);
    const endCol = startCol + Math.ceil(viewWidth / this.tileSize) + 1;
    const startRow = Math.floor(cameraY / this.tileSize);
    const endRow = startRow + Math.ceil(viewHeight / this.tileSize) + 1;

    for (let y = startRow; y <= endRow; y++) {
      if (y < 0 || y >= this.height) continue;
      for (let x = startCol; x <= endCol; x++) {
        if (x < 0 || x >= this.width) continue;

        const tileType = this.tiles[y][x];
        if (tileType === MaterialType.NONE) continue;

        if (silhouette) {
            ctx.fillStyle = silColor || '#fff';
            ctx.fillRect(x * this.tileSize, y * this.tileSize - 8, this.tileSize, this.tileSize + 8);
        } else {
            const cacheKey = `${x},${y}`;
            let cached = this.tileCanvasCache.get(cacheKey);
            if (!cached) {
                cached = this.renderTileToCache(x, y, tileType);
            }
            ctx.drawImage(cached, x * this.tileSize, y * this.tileSize - 8);
        }
      }
    }
  }

  public isWall(x: number, y: number): boolean {
    const gx = Math.floor(x / this.tileSize);
    const gy = Math.floor(y / this.tileSize);
    if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) return true;
    if (this.tiles[gy][gx] === MaterialType.NONE) return false;
    if (this.heatMapRef && this.heatMapRef.isSubTileDestroyed(x, y)) return false;
    return true;
  }

  private rebuildMesh(): void {
      const segments: {a: {x: number, y: number}, b: {x: number, y: number}}[] = [];
      const ts = this.tileSize;

      // 1. Horizontal exposed edges (Top and Bottom of Footprint)
      for (let y = 0; y < this.height; y++) {
          let topStart: number | null = null;
          let botStart: number | null = null;
          
          for (let x = 0; x < this.width; x++) {
              const active = this.tiles[y][x] !== MaterialType.NONE;
              const hasTileAbove = y > 0 && this.tiles[y-1][x] !== MaterialType.NONE;
              const hasTileBelow = y < this.height - 1 && this.tiles[y+1][x] !== MaterialType.NONE;

              if (active && !hasTileAbove) {
                  if (topStart === null) topStart = x;
              } else if (topStart !== null) {
                  segments.push({ a: { x: topStart * ts, y: y * ts }, b: { x: x * ts, y: y * ts } });
                  topStart = null;
              }

              if (active && !hasTileBelow) {
                  if (botStart === null) botStart = x;
              } else if (botStart !== null) {
                  segments.push({ a: { x: botStart * ts, y: (y + 1) * ts }, b: { x: x * ts, y: (y + 1) * ts } });
                  botStart = null;
              }
          }
          if (topStart !== null) segments.push({ a: { x: topStart * ts, y: y * ts }, b: { x: this.width * ts, y: y * ts } });
          if (botStart !== null) segments.push({ a: { x: botStart * ts, y: (y + 1) * ts }, b: { x: this.width * ts, y: (y + 1) * ts } });
      }

      // 2. Vertical exposed edges (Left and Right of Footprint)
      for (let x = 0; x < this.width; x++) {
          let leftStart: number | null = null;
          let rightStart: number | null = null;

          for (let y = 0; y < this.height; y++) {
              const active = this.tiles[y][x] !== MaterialType.NONE;
              const hasTileLeft = x > 0 && this.tiles[y][x-1] !== MaterialType.NONE;
              const hasTileRight = x < this.width - 1 && this.tiles[y][x+1] !== MaterialType.NONE;

              if (active && !hasTileLeft) {
                  if (leftStart === null) leftStart = y;
              } else if (leftStart !== null) {
                  segments.push({ a: { x: x * ts, y: leftStart * ts }, b: { x: x * ts, y: y * ts } });
                  leftStart = null;
              }

              if (active && !hasTileRight) {
                  if (rightStart === null) rightStart = y;
              } else if (rightStart !== null) {
                  segments.push({ a: { x: (x + 1) * ts, y: rightStart * ts }, b: { x: (x + 1) * ts, y: y * ts } });
                  rightStart = null;
              }
          }
          if (leftStart !== null) segments.push({ a: { x: x * ts, y: leftStart * ts }, b: { x: x * ts, y: this.height * ts } });
          if (rightStart !== null) segments.push({ a: { x: (x + 1) * ts, y: rightStart * ts }, b: { x: (x + 1) * ts, y: this.height * ts } });
      }

      // 3. Damaged Tiles
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
      
      // Update Spatial Grid
      this.spatialGrid.clear();
      segments.forEach(seg => {
          const gx1 = Math.floor(Math.min(seg.a.x, seg.b.x) / this.gridCellSize);
          const gy1 = Math.floor(Math.min(seg.a.y, seg.b.y) / this.gridCellSize);
          const gx2 = Math.floor(Math.max(seg.a.x, seg.b.x) / this.gridCellSize);
          const gy2 = Math.floor(Math.max(seg.a.y, seg.b.y) / this.gridCellSize);

          for (let gy = gy1; gy <= gy2; gy++) {
              for (let gx = gx1; gx <= gx2; gx++) {
                  const key = `${gx},${gy}`;
                  if (!this.spatialGrid.has(key)) this.spatialGrid.set(key, []);
                  this.spatialGrid.get(key)!.push(seg);
              }
          }
      });

      this.isMeshDirty = false;
  }

  public getOcclusionSegments(cameraX: number, cameraY: number, viewWidth: number, viewHeight: number): {a: {x: number, y: number}, b: {x: number, y: number}}[] {
      if (this.isMeshDirty) {
          this.rebuildMesh();
      }

      const gx1 = Math.floor((cameraX - 64) / this.gridCellSize);
      const gy1 = Math.floor((cameraY - 64) / this.gridCellSize);
      const gx2 = Math.floor((cameraX + viewWidth + 64) / this.gridCellSize);
      const gy2 = Math.floor((cameraY + viewHeight + 64) / this.gridCellSize);

      const result: Set<{a: {x: number, y: number}, b: {x: number, y: number}}> = new Set();
      for (let gy = gy1; gy <= gy2; gy++) {
          for (let gx = gx1; gx <= gx2; gx++) {
              const cell = this.spatialGrid.get(`${gx},${gy}`);
              if (cell) cell.forEach(s => result.add(s));
          }
      }
      return Array.from(result);
  }
}
