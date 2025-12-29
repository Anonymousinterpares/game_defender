export interface ConfigItem<T> {
  value: T;
  type: 'number' | 'boolean' | 'string';
  min?: number;
  max?: number;
  step?: number;
  description: string;
}

export interface ConfigCategory {
  [key: string]: ConfigItem<any>;
}

export interface GameConfigSchema {
  [category: string]: ConfigCategory;
}

export const MasterConfig: GameConfigSchema = {
  World: {
    width: { value: 50, type: 'number', min: 10, max: 5000, step: 10, description: 'Map Width (Tiles)' },
    height: { value: 50, type: 'number', min: 10, max: 5000, step: 10, description: 'Map Height (Tiles)' },
    tileSize: { value: 32, type: 'number', min: 16, max: 128, step: 1, description: 'Tile Size (Pixels)' },
    renderDistance: { value: 50, type: 'number', min: 10, max: 100, step: 1, description: 'Render Distance (Units)' }
  },
  Player: {
    baseSpeed: { value: 5.0, type: 'number', min: 1.0, max: 50.0, step: 0.5, description: 'Movement Speed (Units/sec)' },
    turnSpeed: { value: 3.0, type: 'number', min: 0.1, max: 10.0, step: 0.1, description: 'Turn Speed (Rad/sec)' },
    maxHealth: { value: 100, type: 'number', min: 1, max: 1000, step: 10, description: 'Base Health' },
    bodyLength: { value: 2, type: 'number', min: 1, max: 20, step: 1, description: 'Additional Body Segments' },
    shootCooldown: { value: 0.2, type: 'number', min: 0.05, max: 2.0, step: 0.01, description: 'Weapon Fire Rate' },
    activeWeapon: { value: 'cannon', type: 'string', description: 'Active Weapon (cannon, laser, ray, rocket, missile, mine)' }
  },
  Weapons: {
    cannonDamage: { value: 10, type: 'number', min: 1, max: 100, step: 1, description: 'Cannon Damage' },
    cannonMaxAmmo: { value: 30, type: 'number', min: 1, max: 200, step: 1, description: 'Cannon Mag Size' },
    cannonReloadTime: { value: 3.0, type: 'number', min: 0.5, max: 10, step: 0.1, description: 'Cannon Reload (s)' },

    laserDPS: { value: 30, type: 'number', min: 1, max: 200, step: 5, description: 'Laser DPS' },
    laserMaxEnergy: { value: 10.0, type: 'number', min: 1, max: 100, step: 1, description: 'Laser Energy' },
    laserDepletionRate: { value: 1.0, type: 'number', min: 0.1, max: 10, step: 0.1, description: 'Laser Depletion (/s)' },
    laserReloadTime: { value: 5.0, type: 'number', min: 1, max: 20, step: 1, description: 'Laser Charge (s)' },

    rayBaseDamage: { value: 150, type: 'number', min: 10, max: 1000, step: 10, description: 'Energy Ray Base Damage' },
    rayMaxEnergy: { value: 15.0, type: 'number', min: 1, max: 100, step: 1, description: 'Ray Energy' },
    rayDepletionRate: { value: 1.0, type: 'number', min: 0.1, max: 10, step: 0.1, description: 'Ray Depletion (/s)' },
    rayReloadTime: { value: 5.0, type: 'number', min: 1, max: 20, step: 1, description: 'Ray Charge (s)' },

    rocketDamage: { value: 60, type: 'number', min: 10, max: 500, step: 10, description: 'Rocket Impact Damage' },
    rocketMaxAmmo: { value: 1, type: 'number', min: 1, max: 10, step: 1, description: 'Rocket Mag Size' },
    rocketReloadTime: { value: 6.0, type: 'number', min: 1, max: 20, step: 1, description: 'Rocket Reload (s)' },
    rocketAOE: { value: 3.5, type: 'number', min: 1, max: 10, step: 0.5, description: 'Rocket AOE Radius' },

    missileDamage: { value: 30, type: 'number', min: 5, max: 300, step: 5, description: 'Missile Damage' },
    missileMaxAmmo: { value: 1, type: 'number', min: 1, max: 10, step: 1, description: 'Missile Mag Size' },
    missileReloadTime: { value: 6.0, type: 'number', min: 1, max: 20, step: 1, description: 'Missile Reload (s)' },
    missileSpeed: { value: 8, type: 'number', min: 2, max: 20, step: 1, description: 'Missile Speed' },
    missileTurnSpeed: { value: 0.1, type: 'number', min: 0.01, max: 0.5, step: 0.01, description: 'Missile Agility' },

    mineDamage: { value: 80, type: 'number', min: 10, max: 1000, step: 10, description: 'Mine Damage' },
    mineMaxAmmo: { value: 1, type: 'number', min: 1, max: 10, step: 1, description: 'Mine Mag Size' },
    mineReloadTime: { value: 2.0, type: 'number', min: 0.5, max: 10, step: 0.1, description: 'Mine Reload (s)' },
    mineAOE: { value: 4.0, type: 'number', min: 1, max: 15, step: 0.5, description: 'Mine AOE Radius' },
    mineArmTime: { value: 1.0, type: 'number', min: 0, max: 5, step: 0.1, description: 'Mine Arming Time (sec)' }
  },
  Upgrades: {
      hullRepairCost: { value: 50, type: 'number', description: 'Repair Cost' },
      speedUpgradeCost: { value: 100, type: 'number', description: 'Engine Tune Cost' },
      fireRateUpgradeCost: { value: 150, type: 'number', description: 'Weapon Upgrade Cost' },
      slotUpgradeCost: { value: 300, type: 'number', description: 'New Slot Cost' },
      turretUpgradeCost: { value: 200, type: 'number', description: 'Turret Cost' },
      shieldUpgradeCost: { value: 250, type: 'number', description: 'Shield Cost' }
  },
  Physics: {
    friction: { value: 0.9, type: 'number', min: 0.1, max: 1.0, step: 0.01, description: 'Movement Friction' },
    collisionPrecision: { value: 0.5, type: 'number', min: 0.1, max: 1.0, step: 0.1, description: 'Collision Check Step' }
  },
  Debug: {
    showHitboxes: { value: false, type: 'boolean', description: 'Show Hitboxes' },
    showGrid: { value: true, type: 'boolean', description: 'Show Map Grid' },
    fpsCounter: { value: true, type: 'boolean', description: 'Show FPS' },
    devModeAlwaysOn: { value: true, type: 'boolean', description: 'Dev commands always active' }
  },
  Visuals: {
    fogOfWar: { value: true, type: 'boolean', description: 'Enable Fog of War' },
    segmentVisibilityRadius: { value: 5.0, type: 'number', min: 1, max: 20, step: 0.5, description: 'Visibility around segments' },
    coneAngle: { value: 60, type: 'number', min: 10, max: 180, step: 5, description: 'Vision Cone Angle (Degrees)' },
    coneDistance: { value: 20.0, type: 'number', min: 5, max: 100, step: 1, description: 'Vision Cone Distance' }
  },
  Keybindings: {
      openDock: { value: 'KeyP', type: 'string', description: 'Open Dock/Shop' }
  }
};

/**
 * Singleton to access current config values easily without dealing with the metadata
 */
export class ConfigManager {
  private static instance: ConfigManager;
  
  // Flattened simplified config for direct access
  // access like ConfigManager.get('World', 'width')
  
  private constructor() {}

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  public get<T>(category: string, key: string): T {
    // @ts-ignore
    return MasterConfig[category][key].value as T;
  }

  public set<T>(category: string, key: string, newValue: T): void {
    if (MasterConfig[category] && MasterConfig[category][key]) {
      // @ts-ignore
      MasterConfig[category][key].value = newValue;
      console.log(`Config Updated: [${category}.${key}] = ${newValue}`);
    }
  }

  // Returns the full schema for UI generation
  public getSchema(): GameConfigSchema {
    return MasterConfig;
  }
}
