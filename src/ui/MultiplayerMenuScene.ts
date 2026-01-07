import { Scene } from '../core/Scene';
import { SceneManager } from '../core/SceneManager';
import { MultiplayerManager, NetworkMessageType } from '../core/MultiplayerManager';
import { EventBus, GameEvent } from '../core/EventBus';

export class MultiplayerMenuScene implements Scene {
  private container: HTMLDivElement | null = null;
  private statusEl: HTMLElement | null = null;
  private joinInput: HTMLInputElement | null = null;

  constructor(private sceneManager: SceneManager) {}

  onEnter(): void {
    this.createUI();
  }

  onExit(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }

  update(dt: number): void {
    const mm = MultiplayerManager.getInstance();
    
    if (this.statusEl && mm.getConnectedPeersCount() > 0) {
        if (mm.isHost) {
            if (!document.getElementById('btn-start-multi')) {
                this.updateHostingUI(mm.myId);
                const statusDiv = document.createElement('div');
                statusDiv.innerHTML = `
                    <span style="color: #0f0;">PEER CONNECTED!</span>
                    <br><br>
                    <button id="btn-start-multi" style="background: #00ff00; color: #000; font-weight: bold; width: 100%; padding: 10px;">START MISSION</button>
                `;
                this.statusEl.appendChild(statusDiv);
                
                document.getElementById('btn-start-multi')?.addEventListener('click', async () => {
                    EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
                    mm.broadcast(NetworkMessageType.CHAT, { system: 'START_GAME' });
                    this.sceneManager.switchScene('multiplayer_gameplay');
                });
            }
        } else {
            if (!this.statusEl.innerHTML.includes('CONNECTED TO HOST')) {
                this.statusEl.innerHTML = `
                    <span style="color: #0f0;">CONNECTED TO HOST!</span><br>
                    <span style="color: #aaa;">Waiting for host to start mission...</span>
                `;
            }
        }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  private createUI(): void {
    const uiLayer = document.getElementById('ui-layer');
    if (!uiLayer) return;

    this.container = document.createElement('div');
    this.container.className = 'ui-panel';
    
    this.container.innerHTML = `
      <h2 style="color: #00ff00;">Multiplayer</h2>
      <div id="mp-status" style="margin-bottom: 20px; color: #aaa; font-family: monospace;">Initialize Connection...</div>
      
      <div class="control-group">
        <label style="display:block; color:#aaa; font-size: 0.8em;">Your Username:</label>
        <input type="text" id="player-name" placeholder="Enter Name" value="Player" 
               style="width: 100%; padding: 8px; background: #000; color: #fff; border: 1px solid #333; margin-bottom: 20px;">
        
        <button id="btn-host">Host Session</button>
        <p style="font-size: 0.8em; color: #666;">Be the server. Others can join your game.</p>
      </div>

      <hr style="border: 0; border-top: 1px solid #333; margin: 20px 0;">

      <div class="control-group">
        <input type="text" id="join-id" placeholder="Enter Host ID (e.g. neon-abc)" 
               style="width: 100%; padding: 8px; background: #000; color: #0f0; border: 1px solid #333; margin-bottom: 10px;">
        <button id="btn-join">Join Session</button>
      </div>

      <button id="btn-back" style="margin-top: 30px;">Back to Menu</button>
    `;

    uiLayer.appendChild(this.container);
    this.statusEl = document.getElementById('mp-status');
    this.joinInput = document.getElementById('join-id') as HTMLInputElement;

    const urlParams = new URLSearchParams(window.location.search);
    const autoJoinId = urlParams.get('join');
    if (autoJoinId) this.joinInput.value = autoJoinId;

    document.getElementById('btn-host')?.addEventListener('click', async () => {
      EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
      const mm = MultiplayerManager.getInstance();
      const nameInput = document.getElementById('player-name') as HTMLInputElement;
      if (nameInput) mm.myName = nameInput.value.trim() || 'Host';
      
      if (this.statusEl) this.statusEl.innerHTML = '<span style="color: #ff0;">INITIALIZING PEER...</span>';

      try {
        const id = await mm.init();
        mm.host();
        this.updateHostingUI(id);
      } catch (err) {
        if (this.statusEl) this.statusEl.innerText = 'Error: ' + err;
      }
    });

    document.getElementById('btn-join')?.addEventListener('click', async () => {
      EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
      const id = this.joinInput?.value.trim();
      if (!id) return;

      const mm = MultiplayerManager.getInstance();
      const nameInput = document.getElementById('player-name') as HTMLInputElement;
      if (nameInput) mm.myName = nameInput.value.trim() || 'Player';

      try {
        await mm.init();
        mm.clearMessageCallbacks(); 
        mm.onMessage(async (msg) => {
            if (msg.t === NetworkMessageType.CHAT && msg.d.system === 'START_GAME') {
                this.sceneManager.switchScene('multiplayer_gameplay');
            }
        });
        mm.join(id);
        if (this.statusEl) this.statusEl.innerText = 'Connecting to ' + id + '...';
      } catch (err) {
        if (this.statusEl) this.statusEl.innerText = 'Error: ' + err;
      }
    });

    document.getElementById('btn-back')?.addEventListener('click', async () => {
      EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
      MultiplayerManager.getInstance().disconnect();
      this.sceneManager.switchScene('menu');
    });
  }

  private updateHostingUI(id: string): void {
      if (!this.statusEl) return;
      this.statusEl.innerHTML = `
          <div id="hosting-info">
              <span style="color: #0f0;">HOSTING ACTIVE</span><br>
              Share this ID: <b style="color: #fff; background: #222; padding: 2px 5px;">${id}</b>
              <br><br>
              <button id="btn-copy-link" style="font-size: 0.7em; padding: 5px;">Copy Join Link</button>
          </div>
      `;
      
      document.getElementById('btn-copy-link')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const url = new URL(window.location.href);
          url.searchParams.set('join', id);
          navigator.clipboard.writeText(url.toString());
          const btn = document.getElementById('btn-copy-link');
          if (btn) btn.innerText = 'COPIED!';
      });
  }
}