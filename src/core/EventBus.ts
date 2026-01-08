
type EventCallback<T = any> = (data: T) => void;

export enum GameEvent {
    // Entity Events
    ENTITY_HIT = 'entity:hit',
    ENTITY_DEATH = 'entity:death',
    
    // Weapon/Combat Events
    WEAPON_FIRED = 'weapon:fired',
    WEAPON_RELOAD = 'weapon:reload',
    PROJECTILE_HIT = 'projectile:hit',
    EXPLOSION = 'explosion',
    MATERIAL_HIT = 'material:hit',
    
    // Item Events
    ITEM_COLLECTED = 'item:collected',
    
    // UI Events
    UI_CLICK = 'ui:click',
    
    // Sound System Direct Control (for cases where we don't have a specific game event)
    SOUND_PLAY = 'sound:play',
    SOUND_PLAY_SPATIAL = 'sound:play_spatial',
    SOUND_LOOP_START = 'sound:loop_start',
    SOUND_LOOP_STOP = 'sound:loop_stop',
    SOUND_LOOP_MOVE = 'sound:loop_move',
}

export interface EventPayloads {
    [GameEvent.ENTITY_HIT]: { x: number, y: number, damage: number, targetId: string, sourceId: string, color?: string };
    [GameEvent.ENTITY_DEATH]: { x: number, y: number, entityId: string, type: string };
    [GameEvent.WEAPON_FIRED]: { x: number, y: number, weaponType: string, ownerId: string, rotation?: number };
    [GameEvent.WEAPON_RELOAD]: { x: number, y: number, ownerId: string };
    [GameEvent.PROJECTILE_HIT]: { x: number, y: number, projectileType: string, hitType: 'entity' | 'wall' | 'indestructible' };
    [GameEvent.EXPLOSION]: { x: number, y: number, radius: number, type: 'small' | 'large', moltenCount?: number };
    [GameEvent.MATERIAL_HIT]: { x: number, y: number, material: string };
    [GameEvent.ITEM_COLLECTED]: { x: number, y: number, itemType: string, collectorId: string };
    [GameEvent.UI_CLICK]: { buttonId?: string };
    [GameEvent.SOUND_PLAY]: { soundId: string, volume?: number };
    [GameEvent.SOUND_PLAY_SPATIAL]: { soundId: string, x: number, y: number, volume?: number };
    [GameEvent.SOUND_LOOP_START]: { soundId: string, x: number, y: number, volume?: number };
    [GameEvent.SOUND_LOOP_STOP]: { soundId: string };
    [GameEvent.SOUND_LOOP_MOVE]: { soundId: string, x: number, y: number };
}

export class EventBus {
    private static instance: EventBus;
    private listeners: Map<string, EventCallback[]> = new Map();

    private constructor() {}

    public static getInstance(): EventBus {
        if (!EventBus.instance) {
            EventBus.instance = new EventBus();
        }
        return EventBus.instance;
    }

    public on<K extends GameEvent>(event: K, callback: EventCallback<EventPayloads[K]>): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(callback);
    }

    public off<K extends GameEvent>(event: K, callback: EventCallback<EventPayloads[K]>): void {
        const eventListeners = this.listeners.get(event);
        if (eventListeners) {
            this.listeners.set(event, eventListeners.filter(l => l !== callback));
        }
    }

    public emit<K extends GameEvent>(event: K, data: EventPayloads[K]): void {
        const eventListeners = this.listeners.get(event);
        if (eventListeners) {
            eventListeners.forEach(callback => callback(data));
        }
    }
}
