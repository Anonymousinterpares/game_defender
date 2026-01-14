import { Component } from "../Component";

export class WeaponComponent implements Component {
    public readonly type = 'weapon';

    public activeWeapon: string = 'cannon';
    public ammo: Map<string, number> = new Map();
    public unlockedWeapons: Set<string> = new Set(['cannon']);
    public reloading: Map<string, boolean> = new Map();
    public reloadTimers: Map<string, number> = new Map();
    public lastShotTime: number = 0;

    constructor() { }
}
