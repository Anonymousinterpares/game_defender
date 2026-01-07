import { ConfigManager } from '../config/MasterConfig';
import { MaterialType } from './HeatMap';

export class World {
  private width: number;
  private height: number;
  private tileSize: number;
  private tiles: MaterialType[][]; // Material of the tile
  private heatMapRef: any = null;
  
  private seed: number;
  private rngState: number;

  // Optimized Shadow Geometry
  private cachedSegments: {a: {x: number, y: number}, b: {x: number, y: number}}[] = [];
  private spatialGrid: Map<string, {a: {x: number, y: number}, b: {x: number, y: number}}[]> = new Map();
  private gridCellSize: number = 256;
  private isMeshDirty: boolean = true;
  private meshVersion: number = 0;

  private sharedTiles: Uint8Array | null = null;
  private onTileChangeCallback: ((tx: number, ty: number) => void) | null = null;

  constructor(seed?: number) {
    this.width = ConfigManager.getInstance().get('World', 'width');
    this.height = ConfigManager.getInstance().get('World', 'height');
    this.tileSize = ConfigManager.getInstance().get('World', 'tileSize');
    this.tiles = [];

    // Init Seed
    this.seed = seed !== undefined ? seed : Date.now();
    this.rngState = this.seed;
    console.log(`World initialized with Seed: ${this.seed}`);

    this.generate();
  }

  public getWidth(): number { return this.width; }
  public getHeight(): number { return this.height; }
  public getTileSize(): number { return this.tileSize; }
  public getTile(x: number, y: number): MaterialType { return this.tiles[y][x]; }
  public getHeatMap(): any { return this.heatMapRef; }

  public onTileChange(cb: (tx: number, ty: number) => void): void {
      this.onTileChangeCallback = cb;
  }

  public notifyTileChange(tx: number, ty: number): void {
      if (this.onTileChangeCallback) this.onTileChangeCallback(tx, ty);
  }

  private seededRandom(): number {
      const a = 1664525;
      const c = 1013904223;
      const m = 4294967296; 
      this.rngState = (a * this.rngState + c) % m;
      return this.rngState / m;
  }

  public setHeatMap(hm: any): void {
      this.heatMapRef = hm;
      this.heatMapRef.setWorldRef(this);
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

  private generate(): void {
    const materials = [MaterialType.WOOD, MaterialType.BRICK, MaterialType.STONE, MaterialType.METAL];
    
    for (let y = 0; y < this.height; y++) {
      const row: MaterialType[] = [];
      for (let x = 0; x < this.width; x++) {
        if (x === 0 || x === this.width - 1 || y === 0 || y === this.height - 1) {
          row.push(MaterialType.INDESTRUCTIBLE);
        } else {
            if (this.seededRandom() < 0.05) {
                const mat = materials[Math.floor(this.seededRandom() * materials.length)];
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

  public checkWallCollision(x: number, y: number, radius: number): {x: number, y: number} | null {
      const points = [
          {x, y},
          {x: x - radius, y}, {x: x + radius, y},
          {x, y: y - radius}, {x, y: y + radius},
          {x: x - radius * 0.7, y: y - radius * 0.7},
          {x: x + radius * 0.7, y: y - radius * 0.7},
          {x: x - radius * 0.7, y: y + radius * 0.7},
          {x: x + radius * 0.7, y: y + radius * 0.7}
      ];

      for (const p of points) {
          if (this.isWall(p.x, p.y)) return p;
      }
      return null;
  }

  public isWall(x: number, y: number): boolean {
    const gx = Math.floor(x / this.tileSize);
    const gy = Math.floor(y / this.tileSize);
    if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) return true;
    if (this.tiles[gy][gx] === MaterialType.NONE) return false;
    if (this.heatMapRef && this.heatMapRef.isSubTileDestroyed(x, y)) return false;
    return true;
  }

  public raycast(startX: number, startY: number, angle: number, maxDist: number): {x: number, y: number} | null {
      const step = 2; 
      const dx = Math.cos(angle) * step;
      const dy = Math.sin(angle) * step;
      
      let curX = startX;
      let curY = startY;
      let dist = 0;
      
      while (dist < maxDist) {
          curX += dx;
          curY += dy;
          dist += step;
          
          if (this.isWall(curX, curY)) {
              return { x: curX, y: curY };
          }
          
          if (curX < 0 || curX > this.getWidthPixels() || curY < 0 || curY > this.getHeightPixels()) {
              return { x: curX, y: curY };
          }
      }
      
      return null;
  }

  private rebuildMesh(): void {
      const segments: {a: {x: number, y: number}, b: {x: number, y: number}}[] = [];
      const ts = this.tileSize;

      for (let y = 0; y < this.height; y++) {
          let topStart: number | null = null;
          let botStart: number | null = null;
          
          for (let x = 0; x < this.width; x++) {
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