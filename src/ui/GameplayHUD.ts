import { SceneManager } from '../core/SceneManager';
import { ConfigManager } from '../config/MasterConfig';
import { Player } from '../entities/Player';
import { WorldClock } from '../core/WorldClock';
import { TurretUpgrade, ShieldUpgrade } from '../entities/upgrades/Upgrade';
import { EventBus, GameEvent } from '../core/EventBus';
import { SoundManager } from '../core/SoundManager';

export interface HUDParent {
    sceneManager: SceneManager;
    player: Player | null;
    coinsCollected: number;
    unlockedWeapons: Set<string>;
    weaponSlots: { [key: string]: string };
    weaponAmmo: Map<string, number>;
    weaponReloading: Map<string, boolean>;
    weaponReloadTimer: Map<string, number>;
    subtractCoins(amount: number): boolean;
    refreshHUD(): void;
}

export class GameplayHUD {
    private backButton: HTMLButtonElement | null = null;
    private muteButton: HTMLButtonElement | null = null;
    private volumeSlider: HTMLInputElement | null = null;
    private clockDisplay: HTMLElement | null = null;
    private dockButton: HTMLButtonElement | null = null;
    private dockContainer: HTMLElement | null = null;
    public isDockOpen: boolean = false;

    constructor(private parent: HUDParent) {}

    public create(): void {
        const uiLayer = document.getElementById('ui-layer');
        if (!uiLayer) return;

        this.backButton = document.createElement('button');
        this.backButton.textContent = 'MENU';
        this.backButton.className = 'hud-btn';
        this.backButton.style.position = 'absolute';
        this.backButton.style.top = '10px';
        this.backButton.style.right = '10px';
        this.backButton.addEventListener('click', () => {
            EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
            this.parent.sceneManager.switchScene('menu');
        });
        uiLayer.appendChild(this.backButton);

        this.muteButton = document.createElement('button');
        this.updateMuteButtonText();
        this.muteButton.className = 'hud-btn';
        this.muteButton.style.position = 'absolute';
        this.muteButton.style.top = '10px';
        this.muteButton.style.right = '100px';
        this.muteButton.addEventListener('click', () => {
            EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
            SoundManager.getInstance().toggleMute();
            this.updateMuteButtonText();
        });
        uiLayer.appendChild(this.muteButton);

        this.volumeSlider = document.createElement('input');
        this.volumeSlider.type = 'range';
        this.volumeSlider.min = '0';
        this.volumeSlider.max = '1';
        this.volumeSlider.step = '0.01';
        this.volumeSlider.value = SoundManager.getInstance().getVolume().toString();
        this.volumeSlider.className = 'hud-slider';
        this.volumeSlider.style.position = 'absolute';
        this.volumeSlider.style.top = '15px';
        this.volumeSlider.style.right = '190px';
        this.volumeSlider.style.width = '80px';
        this.volumeSlider.style.pointerEvents = 'auto';
        this.volumeSlider.addEventListener('input', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            SoundManager.getInstance().setVolume(val);
        });
        uiLayer.appendChild(this.volumeSlider);

        this.clockDisplay = document.createElement('div');
        this.clockDisplay.className = 'hud-text';
        this.clockDisplay.style.position = 'absolute';
        this.clockDisplay.style.top = '10px';
        this.clockDisplay.style.right = '390px';
        this.clockDisplay.style.fontSize = '1.2em';
        this.clockDisplay.style.color = '#cfaa6e';
        this.clockDisplay.style.fontFamily = '"Share Tech Mono", monospace';
        this.clockDisplay.style.padding = '5px 10px';
        this.clockDisplay.style.background = 'rgba(0,0,0,0.5)';
        this.clockDisplay.style.borderRadius = '5px';
        this.clockDisplay.textContent = '00:00';
        uiLayer.appendChild(this.clockDisplay);

        this.dockButton = document.createElement('button');
        this.dockButton.textContent = 'DOCK (P)';
        this.dockButton.className = 'hud-btn';
        this.dockButton.style.position = 'absolute';
        this.dockButton.style.top = '10px';
        this.dockButton.style.right = '280px';
        this.dockButton.addEventListener('click', () => {
            EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
            this.toggleDock();
        });
        uiLayer.appendChild(this.dockButton);
    }

    public updateMuteButtonText(): void {
        if (!this.muteButton) return;
        const muted = SoundManager.getInstance().getMuted();
        this.muteButton.textContent = muted ? 'UNMUTE' : 'MUTE';
    }

    public cleanup(): void {
        if (this.backButton) { this.backButton.remove(); this.backButton = null; }
        if (this.dockButton) { this.dockButton.remove(); this.dockButton = null; }
        if (this.muteButton) { this.muteButton.remove(); this.muteButton = null; }
        if (this.volumeSlider) { this.volumeSlider.remove(); this.volumeSlider = null; }
        if (this.clockDisplay) { this.clockDisplay.remove(); this.clockDisplay = null; }
        if (this.dockContainer) { this.dockContainer.remove(); this.dockContainer = null; }
    }

    public update(dt: number): void {
        if (this.clockDisplay) {
            const state = WorldClock.getInstance().getTimeState();
            const ampm = state.hour >= 12 ? 'PM' : 'AM';
            let displayHour = state.hour % 12;
            if (displayHour === 0) displayHour = 12;
            
            const hh = displayHour.toString().padStart(2, '0');
            const mm = state.minute.toString().padStart(2, '0');
            this.clockDisplay.textContent = `${hh}:${mm} ${ampm}`;
        }
    }

    public toggleDock(): void {
        this.isDockOpen = !this.isDockOpen;
        if (this.isDockOpen) {
            this.openDockUI();
        } else {
            if (this.dockContainer) {
                this.dockContainer.remove();
                this.dockContainer = null;
            }
        }
    }

    private openDockUI(): void {
        const uiLayer = document.getElementById('ui-layer');
        if (!uiLayer) return;

        this.dockContainer = document.createElement('div');
        this.dockContainer.className = 'ui-panel';
        this.dockContainer.style.zIndex = '2000';
        
        uiLayer.appendChild(this.dockContainer);
        this.updateDockContent();
    }

    private updateDockContent(): void {
        if (!this.dockContainer) return;

        const repairCost = ConfigManager.getInstance().get<number>('Upgrades', 'hullRepairCost');
        const speedCost = ConfigManager.getInstance().get<number>('Upgrades', 'speedUpgradeCost');
        const fireRateCost = ConfigManager.getInstance().get<number>('Upgrades', 'fireRateUpgradeCost');
        const slotCost = ConfigManager.getInstance().get<number>('Upgrades', 'slotUpgradeCost');
        const turretCost = ConfigManager.getInstance().get<number>('Upgrades', 'turretUpgradeCost');
        const shieldCost = ConfigManager.getInstance().get<number>('Upgrades', 'shieldUpgradeCost');
        
        this.dockContainer.innerHTML = `
          <h2>ENGINEERING DOCK</h2>
          <p style="text-align: center; color: #cfaa6e; font-size: 1.2em;">COINS: ${this.parent.coinsCollected}</p>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
              <button id="buy-repair" ${this.parent.coinsCollected < repairCost ? 'disabled style="opacity:0.5"' : ''}>Repair Hull (${repairCost})</button>
              <button id="buy-speed" ${this.parent.coinsCollected < speedCost ? 'disabled style="opacity:0.5"' : ''}>Engine Tune (${speedCost})</button>
              <button id="buy-fire" ${this.parent.coinsCollected < fireRateCost ? 'disabled style="opacity:0.5"' : ''}>Weapon Sys (${fireRateCost})</button>
              <button id="buy-slot" ${this.parent.coinsCollected < slotCost ? 'disabled style="opacity:0.5"' : ''}>New Slot (${slotCost})</button>
              <button id="buy-turret" ${this.parent.coinsCollected < turretCost ? 'disabled style="opacity:0.5"' : ''}>Equip Turret (${turretCost})</button>
              <button id="buy-shield" ${this.parent.coinsCollected < shieldCost ? 'disabled style="opacity:0.5"' : ''}>Equip Shield (${shieldCost})</button>
          </div>
          <button id="btn-close-dock" style="margin-top: 20px; background: #594326;">CLOSE DOCK</button>
        `;

        this.dockContainer.querySelector('#buy-repair')?.addEventListener('click', () => {
            if (this.parent.subtractCoins(repairCost)) {
                EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
                this.updateDockContent();
            }
        });

        this.dockContainer.querySelector('#buy-speed')?.addEventListener('click', () => {
            if (this.parent.subtractCoins(speedCost)) {
                EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
                const currentSpeed = ConfigManager.getInstance().get<number>('Player', 'baseSpeed');
                ConfigManager.getInstance().set('Player', 'baseSpeed', currentSpeed + 1);
                if (this.parent.player) this.parent.player.refreshConfig();
                this.updateDockContent();
            }
        });

        this.dockContainer.querySelector('#buy-fire')?.addEventListener('click', () => {
            if (this.parent.subtractCoins(fireRateCost)) {
                EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
                const currentRate = ConfigManager.getInstance().get<number>('Player', 'shootCooldown');
                ConfigManager.getInstance().set('Player', 'shootCooldown', Math.max(0.05, currentRate - 0.02));
                this.parent.refreshHUD();
                this.updateDockContent();
            }
        });

        this.dockContainer.querySelector('#buy-slot')?.addEventListener('click', () => {
            if (this.parent.subtractCoins(slotCost) && this.parent.player) {
                EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
                this.parent.player.addSlot();
                this.updateDockContent();
            }
        });

        this.dockContainer.querySelector('#buy-turret')?.addEventListener('click', () => {
            const freeSlotIdx = this.findFreeSlot();
            if (freeSlotIdx !== -1 && this.parent.subtractCoins(turretCost) && this.parent.player) {
                EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
                const slot = this.parent.player.segments[freeSlotIdx];
                this.parent.player.upgrades.set(freeSlotIdx, new TurretUpgrade(slot));
                this.updateDockContent();
            } else if (freeSlotIdx === -1) {
                alert("NO FREE SLOTS!");
            }
        });

        this.dockContainer.querySelector('#buy-shield')?.addEventListener('click', () => {
            const freeSlotIdx = this.findFreeSlot();
            if (freeSlotIdx !== -1 && this.parent.subtractCoins(shieldCost) && this.parent.player) {
                EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
                const slot = this.parent.player.segments[freeSlotIdx];
                this.parent.player.upgrades.set(freeSlotIdx, new ShieldUpgrade(slot));
                this.updateDockContent();
            } else if (freeSlotIdx === -1) {
                alert("NO FREE SLOTS!");
            }
        });

        this.dockContainer.querySelector('#btn-close-dock')?.addEventListener('click', () => {
            EventBus.getInstance().emit(GameEvent.UI_CLICK, {});
            this.toggleDock();
        });
    }

    private findFreeSlot(): number {
        if (!this.parent.player) return -1;
        for (let i = 0; i < this.parent.player.segments.length; i++) {
            if (!this.parent.player.upgrades.has(i)) return i;
        }
        return -1;
    }

    public render(ctx: CanvasRenderingContext2D): void {
        if (!this.parent.player) return;
        
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        ctx.fillStyle = '#fff';
        ctx.font = '14px Courier';
        ctx.fillText(`POS: ${Math.floor(this.parent.player.x)}, ${Math.floor(this.parent.player.y)}`, 10, 20);
        ctx.fillText(`COINS: ${this.parent.coinsCollected}`, 10, 40);

        const weapon = ConfigManager.getInstance().get<string>('Player', 'activeWeapon');
        const isReloading = this.parent.weaponReloading.get(weapon);
        const reloadTimer = this.parent.weaponReloadTimer.get(weapon) || 0;
        const currentAmmo = this.parent.weaponAmmo.get(weapon) || 0;

        const displayName = weapon === 'missile' ? 'GUIDED MISSILE' : weapon.toUpperCase();

        let ammoText = "";
        if (weapon === 'cannon') {
            ammoText = "AMMO: ∞";
        } else {
            const displayAmmo = weapon === 'laser' || weapon === 'ray' || weapon === 'flamethrower' ? currentAmmo.toFixed(1) : Math.floor(currentAmmo);
            ammoText = isReloading ? `RELOADING... (${reloadTimer.toFixed(1)}s)` : `AMMO: ${displayAmmo}`;
        }
        
        ctx.fillStyle = isReloading ? '#ff4500' : '#cfaa6e';
        ctx.font = 'bold 16px "Share Tech Mono"';
        ctx.fillText(`${displayName} | ${ammoText}`, 10, 70);

        ctx.font = '12px "Share Tech Mono"';
        let slotX = 10;
        Object.entries(this.parent.weaponSlots).forEach(([key, name], i) => {
            const isSelected = name === weapon;
            const isUnlocked = this.parent.unlockedWeapons.has(name);
            const slotDisplayName = name === 'missile' ? 'GUIDED MISSILE' : name.toUpperCase();
            ctx.fillStyle = isSelected ? '#00ff00' : (isUnlocked ? '#888' : '#444');
            ctx.fillText(`${i+1}: ${slotDisplayName}${isSelected ? ' <' : ''}`, slotX, 90 + i * 15);
        });

        if (!this.parent.player.active) {
            ctx.restore(); // Restore early for the overlay
            ctx.save();
            ctx.fillStyle = 'rgba(100, 0, 0, 0.4)';
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            
            ctx.fillStyle = '#ff3300';
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#000';
            ctx.font = 'bold 32px "Share Tech Mono"';
            ctx.textAlign = 'center';
            ctx.fillText('CRITICAL FAILURE: AVATAR OFFLINE', ctx.canvas.width / 2, ctx.canvas.height / 2 - 20);
            
            ctx.font = '16px "Share Tech Mono"';
            ctx.fillStyle = '#fff';
            ctx.fillText('EXCESSIVE HEAT DAMAGE DETECTED', ctx.canvas.width / 2, ctx.canvas.height / 2 + 20);
            ctx.fillText('RELOAD PAGE TO RESTART', ctx.canvas.width / 2, ctx.canvas.height / 2 + 50);
            ctx.restore();
        } else {
            ctx.restore();
        }
    }

    public renderEntityOverlay(ctx: CanvasRenderingContext2D, entity: any, cameraX: number, cameraY: number, nameOverride?: string): void {
        const hix = entity.interpolatedX - cameraX;
        const hiy = entity.interpolatedY - cameraY;
        
        // Name
        ctx.fillStyle = entity.color || '#cfaa6e';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.fillText(nameOverride || (entity as any).name || 'Player', hix, hiy - 30);
        ctx.shadowBlur = 0;

        // Health Bar
        const hbW = 40;
        const hbH = 4;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(hix - hbW/2, hiy - 25, hbW, hbH);
        ctx.fillStyle = entity.health > 30 ? '#0f0' : '#f00';
        ctx.fillRect(hix - hbW/2, hiy - 25, hbW * (entity.health / entity.maxHealth), hbH);
    }
}
