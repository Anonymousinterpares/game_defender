# Project Idea: Modular Arcade Rogue-like

## 1. Architectural Principles
- **Code Modularity & Separation of Concerns:** Logic must be split into multiple separate files. No "monolithic" files; the codebase must be prepared for long-term expansion.
- **Pluggable UI System:** 
    - Designed for "Easy Change of Looks."
    - Each UI skin resides in its own folder within a `UI` directory.
    - Skin folders contain specific files for assets, modules, and components.

## 2. Game Overview
- **Type:** Arcade, Rogue-like.
- **Core Loop:** Combat against NPCs, collecting drops, and upgrading the "Machine."
- **Camera:** Always centered on the player's machine.

## 3. UI & Menu Functionalities
- **Main Menu:**
    - **Start Game**
    - **Settings:**
        - UI Look/Skin selection.
        - Keybindings & Instructions.
        - Difficulty Level.
    - **Game Area Setup:** Configure map size (Default 50x50, Max 5000x5000).
- **Navigation:** Every sub-page must include a "Back" button leading to the Main Menu.

## 4. World & Rendering
- **Tile-Based Map:** The map is composed of 1x1 unit square tiles.
- **Dynamic Rendering:** Only objects within a 50-unit radius of the player are rendered.
- **Backend Tracking:** All game elements (even those off-screen) are tracked silently, asynchronously, and utilizing parallelization for performance.

## 5. Player Machine & Movement
- **Composition:** The machine consists of exactly 3 tiles.
- **Movement Mechanics:** 
    - "Snake-game" style (body segments follow the head).
    - Full 360-degree movement (not restricted to 4 or 8 directions).
- **Controls:** 
    - Desktop: WASD or Arrow Keys.
    - Smartphone: On-screen controller.

## 6. Gameplay Mechanics
- **Spawning Drops:** Random drops appear every 5 to 15 seconds (randomized interval).
- **Drop Types:**
    - Coins (Main currency).
    - Temporary Boosters.
    - Negative Impactors (Debuffs).
- **Combat:** Basic functionality allows shooting projectiles in the direction of movement.

## 7. Radar/Sonar System
- **Location:** Bottom right of the screen.
- **Visual Style:** Submarine-style sonar (round area swipe).
- **Functionality:**
    - Displays object shapes.
    - Moving objects are highlighted in **red**.
- **Audio Feedback:** Proximity "pings" that increase in frequency as objects get closer to the player.

## 8. Upgrade System
### A. Stat Upgrades (Slotless)
*Do not require physical slots on the machine.*
- HP
- Speed
- Shooting Speed
- Damage
- Radar (Scan period and Scan distance)

### B. Physical Upgrades (Slot-based)
*Require a dedicated slot; effects are improved by spending points.*
- **Automatic Turrets:** Various types with unique effects.
- **Energy Shield:** Barrier protecting a specified range (upgradable strength, area, and recovery time).
- **Automatic Healer:** Repairs the machine over time.
- **Drone Ejector:** Produces various types of drones (upgradable drone count, ejection frequency, and drone effectiveness).

### C. Slot Management
- **Progression:** Additional slots can be purchased.
- **Scaling Cost:** Each subsequent slot is more expensive than the last.
- **Balance Trade-off:** Increasing the number of slots reduces the machine's overall speed.
