import { EventBus, GameEvent } from './EventBus';

export enum AssetType {
    IMAGE = 'image',
    AUDIO = 'audio',
    SVG = 'svg'
}

interface AssetDef {
    id: string;
    path: string;
    type: AssetType;
}

export class AssetRegistry {
    private static instance: AssetRegistry;
    private assets: Map<string, HTMLImageElement | ArrayBuffer> = new Map();
    private loadingCount: number = 0;
    private totalCount: number = 0;
    private isLoaded: boolean = false;

    private readonly manifest: AssetDef[] = [
        // Visuals
        { id: 'fire_spritesheet', path: 'assets/visuals/fire_spritesheet.svg', type: AssetType.SVG },
        { id: 'ground_dirt', path: 'assets/visuals/ground_dirt.svg', type: AssetType.SVG },
        { id: 'ground_stone', path: 'assets/visuals/ground_stone.svg', type: AssetType.SVG },
        { id: 'ground_tiles', path: 'assets/visuals/ground_tiles.svg', type: AssetType.SVG },

        // Sounds
        { id: 'brick_hit_1', path: 'assets/sounds/brick_hit_1.wav', type: AssetType.AUDIO },
        { id: 'brick_hit_2', path: 'assets/sounds/brick_hit_2.wav', type: AssetType.AUDIO },
        { id: 'brick_hit_3', path: 'assets/sounds/brick_hit_3.wav', type: AssetType.AUDIO },
        { id: 'collect_coin', path: 'assets/sounds/collect_coin.wav', type: AssetType.AUDIO },
        { id: 'explosion_large', path: 'assets/sounds/explosion_large.wav', type: AssetType.AUDIO },
        { id: 'fire', path: 'assets/sounds/fire.wav', type: AssetType.AUDIO },
        { id: 'hit_cannon', path: 'assets/sounds/hit_cannon.wav', type: AssetType.AUDIO },
        { id: 'hit_laser', path: 'assets/sounds/hit_laser.wav', type: AssetType.AUDIO },
        { id: 'hit_missile', path: 'assets/sounds/hit_missile.wav', type: AssetType.AUDIO },
        { id: 'hit_ray', path: 'assets/sounds/hit_ray.wav', type: AssetType.AUDIO },
        { id: 'indestructible_hit_1', path: 'assets/sounds/indestructible_hit_1.wav', type: AssetType.AUDIO },
        { id: 'metal_hit_1', path: 'assets/sounds/metal_hit_1.wav', type: AssetType.AUDIO },
        { id: 'metal_hit_2', path: 'assets/sounds/metal_hit_2.wav', type: AssetType.AUDIO },
        { id: 'metal_hit_3', path: 'assets/sounds/metal_hit_3.wav', type: AssetType.AUDIO },
        { id: 'metal_hit_4', path: 'assets/sounds/metal_hit_4.wav', type: AssetType.AUDIO },
        { id: 'metal_hit_5', path: 'assets/sounds/metal_hit_5.wav', type: AssetType.AUDIO },
        { id: 'metal_hit_6', path: 'assets/sounds/metal_hit_6.wav', type: AssetType.AUDIO },
        { id: 'ping', path: 'assets/sounds/ping.wav', type: AssetType.AUDIO },
        { id: 'place_mine', path: 'assets/sounds/place_mine.wav', type: AssetType.AUDIO },
        { id: 'shoot_cannon', path: 'assets/sounds/shoot_cannon.wav', type: AssetType.AUDIO },
        { id: 'shoot_laser', path: 'assets/sounds/shoot_laser.wav', type: AssetType.AUDIO },
        { id: 'shoot_missile', path: 'assets/sounds/shoot_missile.wav', type: AssetType.AUDIO },
        { id: 'shoot_ray', path: 'assets/sounds/shoot_ray.wav', type: AssetType.AUDIO },
        { id: 'shoot_rocket', path: 'assets/sounds/shoot_rocket.wav', type: AssetType.AUDIO },
        { id: 'stone_hit_1', path: 'assets/sounds/stone_hit_1.wav', type: AssetType.AUDIO },
        { id: 'ui_click', path: 'assets/sounds/ui_click.wav', type: AssetType.AUDIO },
        { id: 'weapon_reload', path: 'assets/sounds/weapon_reload.wav', type: AssetType.AUDIO },
        { id: 'wood_hit_1', path: 'assets/sounds/wood_hit_1.wav', type: AssetType.AUDIO },
        { id: 'wood_hit_2', path: 'assets/sounds/wood_hit_2.wav', type: AssetType.AUDIO },
        { id: 'wood_hit_3', path: 'assets/sounds/wood_hit_3.wav', type: AssetType.AUDIO },
    ];

    private constructor() {}

    public static getInstance(): AssetRegistry {
        if (!AssetRegistry.instance) {
            AssetRegistry.instance = new AssetRegistry();
        }
        return AssetRegistry.instance;
    }

    public async loadAll(): Promise<void> {
        if (this.isLoaded) return;
        
        this.totalCount = this.manifest.length;
        this.loadingCount = 0;

        const promises = this.manifest.map(asset => this.loadAsset(asset));
        await Promise.all(promises);
        
        this.isLoaded = true;
        console.log('[AssetRegistry] All assets loaded');
    }

    private async loadAsset(def: AssetDef): Promise<void> {
        const fullPath = import.meta.env.BASE_URL + def.path;
        try {
            if (def.type === AssetType.AUDIO) {
                const response = await fetch(fullPath);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const buffer = await response.arrayBuffer();
                this.assets.set(def.id, buffer);
                this.onAssetLoaded();
            } else {
                return new Promise((resolve) => {
                    const img = new Image();
                    img.src = fullPath;
                    img.onload = () => {
                        this.assets.set(def.id, img);
                        this.onAssetLoaded();
                        resolve();
                    };
                    img.onerror = () => {
                        console.error(`Failed to load image: ${fullPath}`);
                        resolve();
                    };
                });
            }
        } catch (err) {
            console.error(`Error loading asset ${def.id} from ${fullPath}:`, err);
        }
    }

    private onAssetLoaded(): void {
        this.loadingCount++;
    }

    public getImage(id: string): HTMLImageElement {
        const asset = this.assets.get(id);
        if (!(asset instanceof HTMLImageElement)) {
            throw new Error(`Asset ${id} not found or is not an image`);
        }
        return asset;
    }

    public getAudioData(id: string): ArrayBuffer {
        const asset = this.assets.get(id);
        if (!(asset instanceof ArrayBuffer)) {
            throw new Error(`Asset ${id} not found or is not audio data`);
        }
        // decodeAudioData detaches the buffer, so we MUST return a copy 
        // to allow re-decoding (e.g. if SoundManager is re-initialized)
        const copy = new ArrayBuffer(asset.byteLength);
        new Uint8Array(copy).set(new Uint8Array(asset));
        return copy;
    }

    public getProgress(): number {
        return this.totalCount === 0 ? 1 : this.loadingCount / this.totalCount;
    }
}