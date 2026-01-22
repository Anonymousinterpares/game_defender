export interface ConfigItem<T> {
  value: T;
  secondary?: T; // For secondary keybindings
  type: 'number' | 'boolean' | 'string' | 'object' | 'color';
  min?: number;
  max?: number;
  step?: number;
  description: string;
  options?: string[]; // For dropdowns
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
    metersPerTile: { value: 0.1, type: 'number', min: 0.1, max: 100, step: 0.1, description: 'Coordinate Scale (Meters per Tile)' },
    wallHeight: { value: 32, type: 'number', min: 4, max: 128, step: 1, description: 'Wall Height (Pixels)' },
    renderDistance: { value: 50, type: 'number', min: 10, max: 100, step: 1, description: 'Render Distance (Units)' }
  },
  Player: {
    baseSpeed: { value: 5.0, type: 'number', min: 1.0, max: 50.0, step: 0.5, description: 'Movement Speed (Units/sec)' },
    turnSpeed: { value: 3.0, type: 'number', min: 0.1, max: 10.0, step: 0.1, description: 'Turn Speed (Rad/sec)' },
    maxHealth: { value: 100, type: 'number', min: 1, max: 1000, step: 10, description: 'Base Health' },
    bodyLength: { value: 2, type: 'number', min: 1, max: 20, step: 1, description: 'Additional Body Segments' },
    shootCooldown: { value: 0.2, type: 'number', min: 0.05, max: 2.0, step: 0.01, description: 'Weapon Fire Rate' },
    activeWeapon: { value: 'cannon', type: 'string', description: 'Active Weapon (cannon, laser, ray, rocket, guided missile, mine)', options: ['cannon', 'laser', 'ray', 'rocket', 'missile', 'mine'] }
  },
  Weapons: {
    cannonDamage: { value: 10, type: 'number', min: 1, max: 100, step: 1, description: 'Cannon Damage' },
    cannonMaxAmmo: { value: 999999, type: 'number', min: 1, max: 1000000, step: 1, description: 'Cannon Mag Size' },
    cannonReloadTime: { value: 0, type: 'number', min: 0, max: 10, step: 0.1, description: 'Cannon Reload (s)' },

    laserDPS: { value: 30, type: 'number', min: 1, max: 200, step: 5, description: 'Laser DPS' },
    laserMaxEnergy: { value: 100.0, type: 'number', min: 1, max: 500, step: 1, description: 'Laser Energy' },
    laserDepletionRate: { value: 10.0, type: 'number', min: 0.1, max: 50, step: 0.1, description: 'Laser Depletion (/s)' },
    laserReloadTime: { value: 5.0, type: 'number', min: 1, max: 20, step: 1, description: 'Laser Charge (s)' },

    rayBaseDamage: { value: 150, type: 'number', min: 10, max: 1000, step: 10, description: 'Energy Ray Base Damage' },
    rayMaxEnergy: { value: 100.0, type: 'number', min: 1, max: 500, step: 1, description: 'Ray Energy' },
    rayDepletionRate: { value: 15.0, type: 'number', min: 0.1, max: 50, step: 0.1, description: 'Ray Depletion (/s)' },
    rayReloadTime: { value: 5.0, type: 'number', min: 1, max: 20, step: 1, description: 'Ray Charge (s)' },

    rocketDamage: { value: 60, type: 'number', min: 10, max: 500, step: 10, description: 'Rocket Impact Damage' },
    rocketMaxAmmo: { value: 30, type: 'number', min: 1, max: 100, step: 1, description: 'Rocket Mag Size' },
    rocketReloadTime: { value: 3.0, type: 'number', min: 1, max: 20, step: 1, description: 'Rocket Reload (s)' },
    rocketAOE: { value: 3.5, type: 'number', min: 1, max: 10, step: 0.5, description: 'Rocket AOE Radius' },

    missileDamage: { value: 30, type: 'number', min: 5, max: 300, step: 5, description: 'Guided Missile Damage' },
    missileMaxAmmo: { value: 60, type: 'number', min: 1, max: 200, step: 1, description: 'Guided Missile Mag Size' },
    missileReloadTime: { value: 4.0, type: 'number', min: 1, max: 20, step: 1, description: 'Guided Missile Reload (s)' },
    missileAOE: { value: 2.5, type: 'number', min: 1, max: 10, step: 0.5, description: 'Guided Missile AOE Radius' },
    missileSpeed: { value: 8, type: 'number', min: 2, max: 20, step: 1, description: 'Guided Missile Speed' },
    missileTurnSpeed: { value: 8.0, type: 'number', min: 0.1, max: 20.0, step: 0.1, description: 'Guided Missile Agility' },
    missileTrackingRange: { value: 500, type: 'number', min: 0, max: 2000, step: 50, description: 'Guided Missile Tracking Range' },

    mineDamage: { value: 80, type: 'number', min: 10, max: 1000, step: 10, description: 'Mine Damage' },
    mineMaxAmmo: { value: 20, type: 'number', min: 1, max: 200, step: 1, description: 'Mine Mag Size' },
    mineReloadTime: { value: 2.0, type: 'number', min: 0.5, max: 10, step: 0.1, description: 'Mine Reload (s)' },
    mineAOE: { value: 4.0, type: 'number', min: 1, max: 15, step: 0.5, description: 'Mine AOE Radius' },
    mineArmTime: { value: 1.0, type: 'number', min: 0, max: 5, step: 0.1, description: 'Mine Arming Time (sec)' },

    flamethrowerDamage: { value: 10, type: 'number', min: 1, max: 200, step: 5, description: 'Flamethrower DPS (Direct)' },
    flamethrowerRange: { value: 3.0, type: 'number', min: 1, max: 10, step: 0.5, description: 'Flamethrower Range (Tiles)' },
    flamethrowerMaxEnergy: { value: 100.0, type: 'number', min: 1, max: 500, step: 1, description: 'Fuel Capacity' },
    flamethrowerDepletionRate: { value: 20.0, type: 'number', min: 0.1, max: 100, step: 0.5, description: 'Fuel Consumption (/s)' },
    flamethrowerReloadTime: { value: 4.0, type: 'number', min: 1, max: 20, step: 1, description: 'Refuel Time (s)' }
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
    groundFriction: { value: 0.1, type: 'number', min: 0.01, max: 1.0, step: 0.01, description: 'Base Ground Friction Coefficient' },
    rainFrictionMultiplier: { value: 0.6, type: 'number', min: 0.1, max: 1.0, step: 0.05, description: 'Friction Multiplier (Rain)' },
    snowFrictionMultiplier: { value: 0.3, type: 'number', min: 0.05, max: 1.0, step: 0.05, description: 'Friction Multiplier (Snow)' },
    gravity: { value: 9.81, type: 'number', min: 0, max: 20, step: 0.1, description: 'Gravity (m/s²)' },
    maxThrust: { value: 2500, type: 'number', min: 100, max: 10000, step: 100, description: 'Maximum Engine Thrust' },
    collisionPrecision: { value: 0.5, type: 'number', min: 0.1, max: 1.0, step: 0.1, description: 'Collision Check Step' }
  },
  Debug: {
    startingCoins: { value: 100000, type: 'number', min: 0, max: 1000000, step: 100, description: 'Starting Coins' },
    showHitboxes: { value: false, type: 'boolean', description: 'Show Hitboxes' },
    showGrid: { value: true, type: 'boolean', description: 'Show Map Grid' },
    fpsCounter: { value: true, type: 'boolean', description: 'Show FPS' },
    FpsShow: { value: true, type: 'boolean', description: 'Show FPS Counter' },
    extendedLogs: { value: false, type: 'boolean', description: 'Show detailed logs (Audio, Net, etc)' },
    physics_logs: { value: false, type: 'boolean', description: 'Show detailed physics calculations' },
    devModeAlwaysOn: { value: true, type: 'boolean', description: 'Dev commands always active' },
    showLatency: { value: true, type: 'boolean', description: 'Show Network Latency' },
    showVersionAndPos: { value: true, type: 'boolean', description: 'Show Version and Position in HUD' },
    enableEnemySpawning: { value: false, type: 'boolean', description: 'Enable Enemy Spawning' },
    webgl_debug: { value: true, type: 'boolean', description: 'Enable detailed WebGL Debug Logs' }
  },
  Mass: {
    playerHead: { value: 10.0, type: 'number', min: 1, max: 100, step: 1, description: 'Mass of Player Head' },
    playerTile: { value: 5.0, type: 'number', min: 1, max: 50, step: 1, description: 'Mass of Empty Tile' },
    turretModule: { value: 8.0, type: 'number', min: 1, max: 50, step: 1, description: 'Mass of Turret Module' },
    shieldModule: { value: 12.0, type: 'number', min: 1, max: 50, step: 1, description: 'Mass of Shield Module' },
    npcScout: { value: 5.0, type: 'number', min: 1, max: 50, step: 1, description: 'Mass of Scout NPC' },
    npcScoutThrust: { value: 1200, type: 'number', min: 100, max: 5000, step: 100, description: 'Thrust for Scout NPC' },
    npcHeavy: { value: 50.0, type: 'number', min: 5, max: 200, step: 5, description: 'Mass of Heavy NPC' },
    npcHeavyThrust: { value: 8000, type: 'number', min: 500, max: 20000, step: 500, description: 'Thrust for Heavy NPC' },
    npcHorde: { value: 3.0, type: 'number', min: 1, max: 20, step: 1, description: 'Mass of Horde NPC' },
    npcHordeThrust: { value: 900, type: 'number', min: 100, max: 3000, step: 50, description: 'Thrust for Horde NPC' }
  },
  Visuals: {
    gpuEnabled: { value: true, type: 'boolean', description: 'Enable GPU Acceleration (Phase 0)' },
    gpuResolutionScale: { value: 1.0, type: 'number', min: 0.1, max: 2.0, step: 0.1, description: 'GPU Render Resolution Scale' },
    enableSmoke: { value: true, type: 'boolean', description: 'Enable Smoke Effects (Wind Responsive)' },
    smokeDensityMultiplier: { value: 1.0, type: 'number', min: 0.1, max: 5.0, step: 0.1, description: 'Smoke Density/Opacity Multiplier' },
    smokeResolutionScale: { value: 0.5, type: 'number', min: 0.1, max: 1.0, step: 0.05, description: 'Smoke Resolution Scale (Performance)' },
    smokeMaxParticles: { value: 5000, type: 'number', min: 100, max: 10000, step: 100, description: 'Max Smoke Particles' },
    fogOfWar: { value: false, type: 'boolean', description: 'Enable Fog of War' },
    segmentVisibilityRadius: { value: 5.0, type: 'number', min: 1, max: 20, step: 0.5, description: 'Visibility around segments' },
    coneAngle: { value: 60, type: 'number', min: 10, max: 180, step: 5, description: 'Vision Cone Angle (Degrees)' },
    coneDistance: { value: 5.0, type: 'number', min: 5, max: 100, step: 1, description: 'Vision Cone Distance' }
  },
  Audio: {
    masterVolume: { value: 0.2, type: 'number', min: 0, max: 1, step: 0.05, description: 'Master Volume' },

    // Per-sound base volumes
    vol_shoot_cannon: { value: 0.4, type: 'number', description: 'Cannon Shot Volume' },
    vol_shoot_laser: { value: 0.3, type: 'number', description: 'Laser Loop Volume' },
    vol_shoot_ray: { value: 0.5, type: 'number', description: 'Ray Loop Volume' },
    vol_shoot_rocket: { value: 0.5, type: 'number', description: 'Rocket Shot Volume' },
    vol_shoot_missile: { value: 0.4, type: 'number', description: 'Missile Shot Volume' },
    vol_place_mine: { value: 0.4, type: 'number', description: 'Mine Place Volume' },
    vol_shoot_flamethrower: { value: 0.5, type: 'number', description: 'Flamethrower Volume' },

    vol_hit_cannon: { value: 0.4, type: 'number', description: 'Cannon Hit Volume' },
    vol_hit_missile: { value: 0.4, type: 'number', description: 'Missile Hit Volume' },
    vol_hit_laser: { value: 0.2, type: 'number', description: 'Laser Hit Volume' },
    vol_hit_ray: { value: 0.3, type: 'number', description: 'Ray Hit Volume' },

    vol_explosion_large: { value: 0.8, type: 'number', description: 'Explosion Volume' },
    vol_weapon_reload: { value: 0.5, type: 'number', description: 'Reload Volume' },
    vol_hit_material: { value: 0.3, type: 'number', description: 'Material Hit Volume' },
    vol_ui_click: { value: 0.2, type: 'number', description: 'UI Click Volume' },
    vol_collect_coin: { value: 0.4, type: 'number', description: 'Collect Coin Volume' },
    vol_ping: { value: 0.1, type: 'number', description: 'Radar Ping Volume' }
  },
  Fire: {
    dps: { value: 10, type: 'number', description: 'Damage per second when burning' },
    spreadChance: { value: 0.1, type: 'number', description: 'Chance to spread fire to sub-tile/neighbor' },
    fireSpreadSpeed: { value: 0.4, type: 'number', min: 0.01, max: 1.0, step: 0.01, description: 'Overall Fire Spread Speed Multiplier' },
    catchChance: { value: 0.5, type: 'number', description: 'Chance to catch fire when touching burning object (per sec)' },
    baseExtinguishChance: { value: 0.5, type: 'number', description: 'Initial chance to stop burning (per sec)' },
    isFireSpritesheet: { value: true, type: 'boolean', description: 'Use sprite-based fire animations' },
    soundClusterSize: { value: 128, type: 'number', description: 'Grid size for clustering fire sounds' },
    volumePerSubTile: { value: 0.005, type: 'number', description: 'Volume contribution per burning sub-tile' },
    maxClusterVolume: { value: 0.8, type: 'number', description: 'Maximum volume for a single fire cluster' },
    soundTTL: { value: 0.2, type: 'number', description: 'Time (s) to keep area sound alive between updates' }
  },
  Lighting: {
    enabled: { value: true, type: 'boolean', description: 'Enable Advanced Lighting System' },
    updateFrequency: { value: 3, type: 'number', description: 'Light update frequency (every N frames)' },
    shadowResolution: { value: 0.5, type: 'number', description: 'Resolution scale for shadow map (0.1 - 1.0)' },
    giBlurAmount: { value: 4, type: 'number', description: 'Global Illumination blur intensity' },
    ambientMin: { value: 0.05, type: 'number', description: 'Minimum ambient light (Night)' },
    ambientMax: { value: 1.0, type: 'number', description: 'Maximum ambient light (Day)' },
    fireLightColor: { value: '#ff6600', type: 'color', description: 'Color of fire light' },
    fireLightRadius: { value: 250, type: 'number', description: 'Radius of fire light clusters' },
    moonColor: { value: '#aaccff', type: 'color', description: 'Color of moonlight' },
    moonShadowMinLen: { value: 50, type: 'number', description: 'Minimum moon shadow length' },
    moonShadowMaxLen: { value: 250, type: 'number', description: 'Maximum moon shadow length' },
    transientLights: {
      value: {
        muzzle: { color: '#ffcc66', intensity: 1.2, radius: 180, ttl: 0.06 },
        impact: { color: '#ffffff', intensity: 1.5, radius: 120, ttl: 0.1 },
        explosion: { color: '#ff7700', intensity: 6.0, radius: 600, ttl: 0.6 }
      },
      type: 'object',
      description: 'Settings for short-lived light sources (Muzzle flash, Impacts, Explosions)'
    }
  },
  TimeSystem: {
    realSecondsPerHour: { value: 120, type: 'number', description: 'Duration of one game hour (seconds)' },
    startHour: { value: 7, type: 'number', description: 'Starting game hour (0-23)' },
    sunriseHour: { value: 6, type: 'number', description: 'Hour when sun starts rising' },
    sunsetHour: { value: 19, type: 'number', description: 'Hour when sun starts setting' },
    moonPhase: { value: 1.0, type: 'number', min: 0, max: 1, step: 0.01, description: 'Starting Moon Phase (0=Null, 1=Full)' },
    randomMoonPhase: { value: false, type: 'boolean', description: 'Randomize starting moon phase' }
  },
  Keybindings: {
    moveUp: { value: 'KeyW', secondary: 'ArrowUp', type: 'string', description: 'Throttle Forward' },
    moveDown: { value: 'KeyS', secondary: 'ArrowDown', type: 'string', description: 'Reverse Gear' },
    moveLeft: { value: 'KeyA', secondary: 'ArrowLeft', type: 'string', description: 'Steer Left' },
    moveRight: { value: 'KeyD', secondary: 'ArrowRight', type: 'string', description: 'Steer Right' },
    fire: { value: 'Space', type: 'string', description: 'Fire Primary Cannon' },
    openDock: { value: 'KeyP', type: 'string', description: 'Open Engineering Dock' }
  },
  Weather: {
    initialWeather: {
      value: 'clear',
      type: 'string',
      description: 'Initial weather type',
      options: ['clear', 'cloudy', 'fog', 'rain', 'snow', 'random']
    },
    transitionSpeed: { value: 0.05, type: 'number', min: 0.01, max: 1.0, step: 0.01, description: 'Speed of weather transitions' },
    windMinSpeed: { value: 0.5, type: 'number', min: 0, max: 10, step: 0.1, description: 'Minimum wind speed (m/s)' },
    windMaxSpeed: { value: 15.0, type: 'number', min: 0, max: 50, step: 0.1, description: 'Maximum wind speed (m/s)' }
  },
  Benchmark: {
    showPerfMetrics: { value: false, type: 'boolean', description: 'Show Performance Graphs' },
    resolutionScale: { value: 1.0, type: 'number', min: 0.1, max: 1.0, step: 0.1, description: 'Lighting Resolution Scale' }
  }
};

/**
 * Singleton to access current config values easily without dealing with the metadata
 */
export class ConfigManager {
  private static instance: ConfigManager;

  // Flattened simplified config for direct access
  // access like ConfigManager.get('World', 'width')

  private constructor() {
    this.loadFromLocalStorage();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  public get<T>(category: string, key: string): T {
    // @ts-ignore
    const cat = MasterConfig[category];
    if (cat && cat[key]) {
      return cat[key].value as T;
    }
    // @ts-ignore
    return undefined;
  }

  public getPixelsPerMeter(): number {
    return this.get<number>('World', 'tileSize') / this.get<number>('World', 'metersPerTile');
  }

  public getMetersPerTile(): number {
    return this.get<number>('World', 'metersPerTile');
  }

  public set<T>(category: string, key: string, newValue: T): void {
    if (MasterConfig[category] && MasterConfig[category][key]) {
      // @ts-ignore
      MasterConfig[category][key].value = newValue;
      console.log(`Config Updated: [${category}.${key}] = ${newValue}`);
      this.saveToLocalStorage();
    }
  }

  private saveToLocalStorage(): void {
    try {
      const flatConfig: Record<string, any> = {};
      for (const cat in MasterConfig) {
        flatConfig[cat] = {};
        for (const key in MasterConfig[cat]) {
          flatConfig[cat][key] = MasterConfig[cat][key].value;
        }
      }
      localStorage.setItem('neon_rogue_config', JSON.stringify(flatConfig));
    } catch (e) {
      console.warn('Failed to save config to localStorage', e);
    }
  }

  public resetToDefaults(): void {
    localStorage.removeItem('neon_rogue_config');
    // Reload page or re-initialize? For now, just clear and log.
    console.warn('Config reset to defaults. Please reload to apply all changes.');
  }

  private loadFromLocalStorage(): void {
    try {
      const saved = localStorage.getItem('neon_rogue_config');
      if (saved) {
        const flatConfig = JSON.parse(saved);
        for (const cat in flatConfig) {
          if (MasterConfig[cat]) {
            for (const key in flatConfig[cat]) {
              if (MasterConfig[cat][key]) {
                // SPECIAL CASE: If we are in development and the code value for metersPerTile 
                // has been changed by the user, we might want to respect it. 
                // But for now, we follow standard persistence.
                MasterConfig[cat][key].value = flatConfig[cat][key];
              }
            }
          }
        }
        console.log('Config loaded from localStorage');

        // Ensure metersPerTile is at least the minimum
        const mpt = this.get<number>('World', 'metersPerTile');
        if (mpt < 0.1) {
          MasterConfig.World.metersPerTile.value = 0.1;
        }
      }
    } catch (e) {
      console.warn('Failed to load config from localStorage', e);
    }
  }

  // Returns the full schema for UI generation
  public getSchema(): GameConfigSchema {
    return MasterConfig;
  }
}
