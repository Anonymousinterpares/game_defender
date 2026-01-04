import { ConfigManager } from '../config/MasterConfig';
import { World } from './World';
import { WeatherManager, WeatherType } from './WeatherManager';

export interface PhysicsBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number; // For circle collision
  width?: number; // For AABB
  height?: number; // For AABB
  isStatic: boolean;
}

export class PhysicsEngine {
  private bodies: PhysicsBody[] = [];
  private world: World | null = null;

  // Spatial Partitioning
  private spatialGrid: Map<string, PhysicsBody[]> = new Map();
  private gridSize: number = 128; // Size of each grid cell in pixels

  constructor() {}

  public setWorld(world: World): void {
    this.world = world;
  }

  public addBody(body: PhysicsBody): void {
    this.bodies.push(body);
  }

  public removeBody(body: PhysicsBody): void {
    this.bodies = this.bodies.filter(b => b !== body);
  }

  private updateGrid(): void {
    this.spatialGrid.clear();
    for (const body of this.bodies) {
      const gx = Math.floor(body.x / this.gridSize);
      const gy = Math.floor(body.y / this.gridSize);
      const key = `${gx},${gy}`;
      
      if (!this.spatialGrid.has(key)) {
        this.spatialGrid.set(key, []);
      }
      this.spatialGrid.get(key)!.push(body);
    }
  }

  public update(dt: number): void {
    let friction = ConfigManager.getInstance().get<number>('Physics', 'friction');
    
    // 1. Update Spatial Grid first for accurate queries
    this.updateGrid();

    // Apply weather friction modifiers
    const weather = WeatherManager.getInstance().getWeatherState();
    if (weather.type === WeatherType.RAIN) {
        friction *= 0.95;
    } else if (weather.type === WeatherType.SNOW) {
        friction *= 0.85;
    }

    for (const body of this.bodies) {
      if (body.isStatic) continue;

      // 1. Apply Friction
      body.vx *= Math.pow(friction, dt * 60);
      body.vy *= Math.pow(friction, dt * 60);

      // 2. Predict Next Position
      let nextX = body.x + body.vx * dt;
      let nextY = body.y + body.vy * dt;

      // 3. World Collision & Bounds
      if (this.world) {
        const mapW = this.world.getWidthPixels();
        const mapH = this.world.getHeightPixels();

        if (this.world.isWall(nextX, body.y)) {
           body.vx = 0; 
           nextX = body.x; 
        }
        
        if (this.world.isWall(nextX, nextY)) {
             nextX = body.x;
             nextY = body.y;
             
             if (this.world.isWall(nextX, nextY)) {
                 const cx = mapW/2;
                 const cy = mapH/2;
                 const dx = cx - nextX;
                 const dy = cy - nextY;
                 const len = Math.sqrt(dx*dx+dy*dy) || 1;
                 nextX += (dx/len) * 1.0; 
                 nextY += (dy/len) * 1.0;
             }
        }
        
        if (nextX < body.radius) { nextX = body.radius; body.vx = 0; }
        if (nextX > mapW - body.radius) { nextX = mapW - body.radius; body.vx = 0; }
        if (nextY < body.radius) { nextY = body.radius; body.vy = 0; }
        if (nextY > mapH - body.radius) { nextY = mapH - body.radius; body.vy = 0; }
      }

      // 4. Optimized Body vs Body Collision (Spatial Partitioning)
      const gx = Math.floor(nextX / this.gridSize);
      const gy = Math.floor(nextY / this.gridSize);

      // Check 3x3 grid around the body
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const key = `${gx + ox},${gy + oy}`;
          const cell = this.spatialGrid.get(key);
          if (!cell) continue;

          for (const other of cell) {
            if (body === other || other.isStatic) continue;
            
            const dx = nextX - other.x;
            const dy = nextY - other.y;
            const distSq = dx*dx + dy*dy;
            const radSum = body.radius + other.radius;
            
            if (distSq < radSum * radSum && distSq > 0) {
                const dist = Math.sqrt(distSq);
                const overlap = radSum - dist;
                const nx = dx / dist;
                const ny = dy / dist;
                
                nextX += nx * overlap * 0.5;
                nextY += ny * overlap * 0.5;
            }
          }
        }
      }

      // 5. Commit Move
      body.x = nextX;
      body.y = nextY;
    }
  }

  /**
   * Returns bodies within a specific area, optimized via spatial grid.
   */
  public getNearbyBodies(x: number, y: number, radius: number): PhysicsBody[] {
    const result: PhysicsBody[] = [];
    const gx = Math.floor(x / this.gridSize);
    const gy = Math.floor(y / this.gridSize);
    const gridRadius = Math.ceil(radius / this.gridSize);

    for (let ox = -gridRadius; ox <= gridRadius; ox++) {
      for (let oy = -gridRadius; oy <= gridRadius; oy++) {
        const cell = this.spatialGrid.get(`${gx + ox},${gy + oy}`);
        if (cell) {
          for (const body of cell) {
            const dx = x - body.x;
            const dy = y - body.y;
            if (dx * dx + dy * dy < (radius + body.radius) * (radius + body.radius)) {
              result.push(body);
            }
          }
        }
      }
    }
    return result;
  }

  // Basic Circle-Circle Collision
  public checkCollision(a: PhysicsBody, b: PhysicsBody): boolean {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const distSq = dx * dx + dy * dy;
    const radSum = a.radius + b.radius;
    return distSq < radSum * radSum;
  }
}
