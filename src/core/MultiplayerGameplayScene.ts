import { GameplayScene } from './GameplayScene';
import { MultiplayerManager, NetworkMessageType } from './MultiplayerManager';
import { RemotePlayer } from '../entities/RemotePlayer';
import { SceneManager } from './SceneManager';
import { InputManager } from './InputManager';

export class MultiplayerGameplayScene extends GameplayScene {
  private remotePlayers: Map<string, RemotePlayer> = new Map();
  private networkTickRate: number = 0.05; // 20 times per second
  private networkTimer: number = 0;

  constructor(sceneManager: SceneManager, inputManager: InputManager) {
    super(sceneManager, inputManager);
  }

  onEnter(): void {
    super.onEnter();
    
    const mm = MultiplayerManager.getInstance();
    
    // Listen for network messages
    mm.onMessage((msg, conn) => {
      switch (msg.t) {
        case NetworkMessageType.PLAYER_STATE:
          this.handlePlayerState(msg.d);
          break;
      }
    });

    console.log('Multiplayer Scene Started. Host:', mm.isHost);
  }

  onExit(): void {
    super.onExit();
    this.remotePlayers.clear();
  }

  update(dt: number): void {
    super.update(dt);
    
    // Update remote players
    this.remotePlayers.forEach(rp => rp.update(dt));

    // Send local state to others
    this.networkTimer += dt;
    if (this.networkTimer >= this.networkTickRate) {
      this.sendLocalState();
      this.networkTimer = 0;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    // We let super.render draw the world and local player
    super.render(ctx);

    // Draw remote players
    ctx.save();
    ctx.translate(-this.cameraX, -this.cameraY);
    this.remotePlayers.forEach(rp => rp.render(ctx));
    ctx.restore();
  }

  private sendLocalState(): void {
    if (!this.player) return;

    const state = {
      id: MultiplayerManager.getInstance().myId,
      x: this.player.x,
      y: this.player.y,
      r: this.rotationToNetwork(this.player.rotation)
    };

    MultiplayerManager.getInstance().broadcast(NetworkMessageType.PLAYER_STATE, state);
  }

  private handlePlayerState(data: any): void {
    const { id, x, y, r } = data;
    if (id === MultiplayerManager.getInstance().myId) return;

    let rp = this.remotePlayers.get(id);
    if (!rp) {
      console.log('New remote player joined:', id);
      rp = new RemotePlayer(id, x, y);
      this.remotePlayers.set(id, rp);
    }

    rp.updateFromNetwork(x, y, this.rotationFromNetwork(r));
  }

  // Compression helper: send rotation as a byte or short instead of full float
  private rotationToNetwork(rad: number): number {
    return Math.round(rad * 1000); 
  }

  private rotationFromNetwork(net: number): number {
    return net / 1000;
  }
}
