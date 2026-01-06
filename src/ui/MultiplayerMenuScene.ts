import { Scene } from '../core/Scene';
import { SceneManager } from '../core/SceneManager';
import { SoundManager } from '../core/SoundManager';
import { MultiplayerManager, NetworkMessageType } from '../core/MultiplayerManager';

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
    
    // Debugging: only log if state changes or every few seconds
    if ((window as any).lastMPCount !== mm.getConnectedPeersCount()) {
        console.log(`[MENU] MP State - Peers: ${mm.getConnectedPeersCount()}, IsHost: ${mm.isHost}`);
        (window as any).lastMPCount = mm.getConnectedPeersCount();
    }

    if (this.statusEl && mm.getConnectedPeersCount() > 0) {
        if (mm.isHost) {
            // Only show start button if it's not already there
            if (!document.getElementById('btn-start-multi')) {
                this.statusEl.innerHTML = `
                    <span style="color: #0f0;">HOSTING ACTIVE</span><br>
                    Share this ID: <b style="color: #fff; background: #222; padding: 2px 5px;">${mm.myId}</b>
                    <br><br>
                    <span style="color: #0f0;">PEER CONNECTED!</span>
                    <br><br>
                    <button id="btn-start-multi" style="background: #00ff00; color: #000; font-weight: bold; width: 100%; padding: 10px;">START MISSION</button>
                `;
                document.getElementById('btn-start-multi')?.addEventListener('click', () => {
                    SoundManager.getInstance().playSound('ui_click');
                    mm.broadcast(NetworkMessageType.CHAT, { system: 'START_GAME' });
                    this.sceneManager.switchScene('multiplayer_gameplay');
                });
            }
        } else {
            // Client connected
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

    // Check if we have an ID in URL to auto-join
    const urlParams = new URLSearchParams(window.location.search);
    const autoJoinId = urlParams.get('join');
    if (autoJoinId) {
        this.joinInput.value = autoJoinId;
    }

    document.getElementById('btn-host')?.addEventListener('click', async () => {
      SoundManager.getInstance().playSound('ui_click');
      const mm = MultiplayerManager.getInstance();
      const nameInput = document.getElementById('player-name') as HTMLInputElement;
      if (nameInput) mm.myName = nameInput.value.trim() || 'Host';
      
      try {
        const id = await mm.init();
        mm.host();
        if (this.statusEl) {
            this.statusEl.innerHTML = `
                <span style="color: #0f0;">HOSTING ACTIVE</span><br>
                Share this ID: <b style="color: #fff; background: #222; padding: 2px 5px;">${id}</b>
                <br><br>
                <button id="btn-copy-link" style="font-size: 0.7em; padding: 5px;">Copy Join Link</button>
            `;
            
            document.getElementById('btn-copy-link')?.addEventListener('click', () => {
                const url = new URL(window.location.href);
                url.searchParams.set('join', id);
                navigator.clipboard.writeText(url.toString());
                const btn = document.getElementById('btn-copy-link');
                if (btn) btn.innerText = 'COPIED!';
            });
        }
      } catch (err) {
        if (this.statusEl) this.statusEl.innerText = 'Error: ' + err;
      }
    });

    document.getElementById('btn-join')?.addEventListener('click', async () => {
      SoundManager.getInstance().playSound('ui_click');
      const id = this.joinInput?.value.trim();
      if (!id) return;

      const mm = MultiplayerManager.getInstance();
      const nameInput = document.getElementById('player-name') as HTMLInputElement;
      if (nameInput) mm.myName = nameInput.value.trim() || 'Player';

      try {
        await mm.init(); // Always try to init/reconnect
        mm.clearMessageCallbacks(); 
        mm.onMessage((msg) => {
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

    document.getElementById('btn-back')?.addEventListener('click', () => {
      SoundManager.getInstance().playSound('ui_click');
      MultiplayerManager.getInstance().disconnect();
      this.sceneManager.switchScene('menu');
    });
  }
}
