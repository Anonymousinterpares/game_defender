import { ConfigManager } from '../config/MasterConfig';
import { World } from './World';

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

  public update(dt: number): void {
    const friction = ConfigManager.getInstance().get<number>('Physics', 'friction');
    
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

        // Check X axis
        if (this.world.isWall(nextX, body.y)) {
           body.vx = 0; 
           // If we are already inside, we need to push out?
           // Simple 'stop' isn't enough if we were dragged in.
           // Check if current x is valid.
           if (this.world.isWall(body.x, body.y)) {
               // We are stuck. Push towards center? or opposite of velocity?
               // Since vx is 0, we don't know direction.
               // Try resetting to valid previous if available, or just don't move nextX.
               nextX = body.x; 
               // This doesn't solve overlap.
           } else {
               nextX = body.x; // Hit wall, stop.
           }
        }
        
        // This logic is flawed for dragged segments.
        // We need a separate "ResolveOverlaps" pass.
        
        // Let's implement a rudimentary "Push Out of Wall"
        // We check 4 directions?
        if (this.world.isWall(nextX, nextY)) {
             // Basic: Undo move
             nextX = body.x;
             nextY = body.y;
             
             // If still in wall (dragged in), brute force push to nearest tile center?
             // Or just simple bounce?
             if (this.world.isWall(nextX, nextY)) {
                 // Emergency Eject: Move towards map center
                 const cx = mapW/2;
                 const cy = mapH/2;
                 const dx = cx - nextX;
                 const dy = cy - nextY;
                 const len = Math.sqrt(dx*dx+dy*dy) || 1;
                 nextX += (dx/len) * 1.0; // Slow push out
                 nextY += (dy/len) * 1.0;
             }
        }
        
        if (nextX < body.radius) { nextX = body.radius; body.vx = 0; }
        if (nextX > mapW - body.radius) { nextX = mapW - body.radius; body.vx = 0; }
        if (nextY < body.radius) { nextY = body.radius; body.vy = 0; }
        if (nextY > mapH - body.radius) { nextY = mapH - body.radius; body.vy = 0; }
      }

      // 4. Body vs Body Collision (Simple Push)
      // Iterate other bodies
      for (const other of this.bodies) {
          if (body === other) continue;
          if (other.isStatic) continue; // Static bodies don't push? Or do they?
          
          const dx = nextX - other.x;
          const dy = nextY - other.y;
          const distSq = dx*dx + dy*dy;
          const radSum = body.radius + other.radius;
          
          if (distSq < radSum * radSum && distSq > 0) {
              const dist = Math.sqrt(distSq);
              const overlap = radSum - dist;
              
              // Push apart
              const nx = dx / dist;
              const ny = dy / dist;
              
              // Apply push to current body (and maybe other body next frame)
              // Ideally solve both, but sequential is fine for arcade.
              nextX += nx * overlap * 0.5;
              nextY += ny * overlap * 0.5;
              
              // We don't push 'other' here to avoid double counting or mess up loop.
              // Just self-correction.
          }
      }

      // 5. Commit Move
      body.x = nextX;
      body.y = nextY;
    }
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
