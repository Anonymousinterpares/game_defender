import { ConfigManager } from '../config/MasterConfig';
import { MaterialType } from './HeatMap';
import { WeatherManager } from './WeatherManager';

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
  private wallChunks: Map<string, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, dirty: boolean }> = new Map();
  private chunkSize: number = 512;
  private lastSnowAccumulation: number = 0;
  private sharedTiles: Uint8Array | null = null;

  private scratchCanvas: HTMLCanvasElement;
  private scratchCtx: CanvasRenderingContext2D;

  constructor() {
    this.width = ConfigManager.getInstance().get('World', 'width');
    this.height = ConfigManager.getInstance().get('World', 'height');
    this.tileSize = ConfigManager.getInstance().get('World', 'tileSize');
    this.tiles = [];

    this.scratchCanvas = document.createElement('canvas');
    this.scratchCanvas.width = this.chunkSize;
    this.scratchCanvas.height = this.chunkSize + 32;
    this.scratchCtx = this.scratchCanvas.getContext('2d')!;

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
          this.synchronizeSharedBuffer();
      }
  }

  public checkTileDestruction(tx: number, ty: number): void {
      if (this.heatMapRef && this.heatMapRef.isTileMostlyDestroyed(tx, ty)) {
          this.tiles[ty][tx] = MaterialType.NONE;
          this.markMeshDirty();
      }
  }

  public getMeshVersion(): number {
      return this.meshVersion;
  }

  public getTilesSharedBuffer(): SharedArrayBuffer {
      if (!this.sharedTiles) {
          const size = this.width * this.height;
          let buffer: any;
          try {
              buffer = new (window.SharedArrayBuffer || ArrayBuffer)(size);
          } catch (e) {
              buffer = new ArrayBuffer(size);
          }
          this.sharedTiles = new Uint8Array(buffer);
          this.synchronizeSharedBuffer();
      }
      return this.sharedTiles.buffer as SharedArrayBuffer;
  }

  public synchronizeSharedBuffer(): void {
      if (!this.sharedTiles) return;
      for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
              this.sharedTiles[y * this.width + x] = this.tiles[y][x];
          }
      }
  }

  public invalidateTileCache(tx: number, ty: number): void {
      this.tileCanvasCache.delete(`${tx},${ty}`);
      
      const gx = Math.floor((tx * this.tileSize) / this.chunkSize);
      const gy = Math.floor((ty * this.tileSize) / this.chunkSize);
      const chunk = this.wallChunks.get(`${gx},${gy}`);
      if (chunk) {
          chunk.dirty = true;
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

          // Snow on top
          const snow = WeatherManager.getInstance().getSnowAccumulation();
          if (snow > 0.1) {
              ctx.fillStyle = `rgba(240, 245, 255, ${snow})`;
              ctx.fillRect(0, 0, this.tileSize, 2 + snow * 4);
          }

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

  public renderAsSilhouette(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, color?: string): void {
      this.renderInternal(ctx, cameraX, cameraY, true, color);
  }

  private renderInternal(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, silhouette: boolean, silColor?: string): void {
    const viewWidth = ctx.canvas.width;
    const viewHeight = ctx.canvas.height;
    
    // Check if snow changed enough to invalidate cache
    const currentSnow = WeatherManager.getInstance().getSnowAccumulation();
    if (Math.abs(currentSnow - this.lastSnowAccumulation) > 0.05) {
        this.tileCanvasCache.clear();
        this.wallChunks.forEach(c => c.dirty = true);
        this.lastSnowAccumulation = currentSnow;
    }

    if (!silhouette) {
        // Procedural background instead of massive canvas
        let groundColor = '#1c1c1c';
        if (currentSnow > 0) {
            const r = Math.floor(28 + (200 - 28) * currentSnow);
            const g = Math.floor(28 + (210 - 28) * currentSnow);
            const b = Math.floor(28 + (230 - 28) * currentSnow);
            groundColor = `rgb(${r},${g},${b})`;
        }

        ctx.fillStyle = groundColor;
        ctx.fillRect(cameraX, cameraY, viewWidth, viewHeight);

        // Draw Grid Lines for visible area
        ctx.beginPath();
        ctx.strokeStyle = currentSnow > 0.5 ? 'rgba(255,255,255,0.1)' : '#222222';
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
    }

    // 2. Render Walls via Chunks
    const startGX = Math.floor(cameraX / this.chunkSize);
    const endGX = Math.floor((cameraX + viewWidth) / this.chunkSize);
    const startGY = Math.floor(cameraY / this.chunkSize);
    const endGY = Math.floor((cameraY + viewHeight) / this.chunkSize);

    for (let gy = startGY; gy <= endGY; gy++) {
        for (let gx = startGX; gx <= endGX; gx++) {
            if (gx < 0 || gx >= Math.ceil(this.getWidthPixels() / this.chunkSize) ||
                gy < 0 || gy >= Math.ceil(this.getHeightPixels() / this.chunkSize)) continue;

            const key = `${gx},${gy}`;
            let chunk = this.wallChunks.get(key);
            
            if (!chunk) {
                const canvas = document.createElement('canvas');
                canvas.width = this.chunkSize;
                canvas.height = this.chunkSize + 32;
                chunk = { canvas, ctx: canvas.getContext('2d')!, dirty: true };
                this.wallChunks.set(key, chunk);
            }

            if (chunk.dirty) {
                this.rebuildWallChunk(chunk, gx, gy);
                chunk.dirty = false;
            }

            if (silhouette) {
                // When rendering silhouette for shadows, we must draw at absolute world coords
                // to match the shadow volume coordinate space.
                ctx.save();
                if (silColor) {
                    // Use shared scratch canvas to tint
                    const sctx = this.scratchCtx;
                    sctx.clearRect(0, 0, this.chunkSize, this.chunkSize + 32);
                    sctx.drawImage(chunk.canvas, 0, 0);
                    sctx.globalCompositeOperation = 'source-in';
                    sctx.fillStyle = silColor;
                    sctx.fillRect(0, 0, this.chunkSize, this.chunkSize + 32);
                    sctx.globalCompositeOperation = 'source-over'; // Reset
                    
                    ctx.drawImage(this.scratchCanvas, gx * this.chunkSize, gy * this.chunkSize - 8);
                } else {
                    ctx.drawImage(chunk.canvas, gx * this.chunkSize, gy * this.chunkSize - 8);
                }
                ctx.restore();
            } else {
                ctx.drawImage(chunk.canvas, gx * this.chunkSize, gy * this.chunkSize - 8);
            }
        }
    }
  }

  private rebuildWallChunk(chunk: any, gx: number, gy: number): void {
      const ctx = chunk.ctx;
      ctx.clearRect(0, 0, this.chunkSize, this.chunkSize + 32);
      
      const startCol = Math.floor((gx * this.chunkSize) / this.tileSize);
      const endCol = Math.ceil(((gx + 1) * this.chunkSize) / this.tileSize);
      const startRow = Math.floor((gy * this.chunkSize) / this.tileSize);
      const endRow = Math.ceil(((gy + 1) * this.chunkSize) / this.tileSize);

      for (let y = startRow; y < endRow; y++) {
          if (y < 0 || y >= this.height) continue;
          for (let x = startCol; x < endCol; x++) {
              if (x < 0 || x >= this.width) continue;

              const tileType = this.tiles[y][x];
              if (tileType === MaterialType.NONE) continue;

              const cacheKey = `${x},${y}`;
              let cached = this.tileCanvasCache.get(cacheKey);
              if (!cached) {
                  cached = this.renderTileToCache(x, y, tileType);
              }
              // Draw relative to chunk origin
              ctx.drawImage(cached, (x * this.tileSize) - (gx * this.chunkSize), (y * this.tileSize) - (gy * this.chunkSize));
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
              // Only use full-tile logic if tile exists AND has no sub-tile damage data
              const hasDamageData = this.heatMapRef && this.heatMapRef.hasTileData(x, y);
              const active = this.tiles[y][x] !== MaterialType.NONE && !hasDamageData;
              
              const hasTileAbove = y > 0 && this.tiles[y-1][x] !== MaterialType.NONE && !(this.heatMapRef && this.heatMapRef.hasTileData(x, y-1));
              const hasTileBelow = y < this.height - 1 && this.tiles[y+1][x] !== MaterialType.NONE && !(this.heatMapRef && this.heatMapRef.hasTileData(x, y+1));

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
              const hasDamageData = this.heatMapRef && this.heatMapRef.hasTileData(x, y);
              const active = this.tiles[y][x] !== MaterialType.NONE && !hasDamageData;

              const hasTileLeft = x > 0 && this.tiles[y][x-1] !== MaterialType.NONE && !(this.heatMapRef && this.heatMapRef.hasTileData(x-1, y));
              const hasTileRight = x < this.width - 1 && this.tiles[y][x+1] !== MaterialType.NONE && !(this.heatMapRef && this.heatMapRef.hasTileData(x+1, y));

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
