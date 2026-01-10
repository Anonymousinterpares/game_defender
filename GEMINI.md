# Project: Modular Rogue-like (Neon Rogue)

## 1. Project Overview
This is a modular, arcade-style Rogue-like game engine built with **TypeScript** and **Vite**. The game features a unique "snake-like" movement mechanic where the player controls a multi-segment machine. It supports multiplayer capabilities via P2P networking (PeerJS).

### Key Features
- **Genre:** Arcade / Rogue-like.
- **Core Mechanic:** 360-degree snake-movement combat.
- **Rendering:** Custom 2D rendering (likely Canvas-based) with a focus on dynamic lighting and visibility.
- **Networking:** Peer-to-Peer multiplayer using PeerJS.
- **Architecture:** Strict Entity Component System (ECS).

## 2. Technical Stack
- **Language:** TypeScript
- **Bundler/Dev Server:** Vite
- **Styling:** SCSS (`src/styles/`)
- **Networking:** PeerJS (Client-side WebRTC wrapper)
- **Asset Management:** Custom `AssetRegistry` with support for UI skins (`src/ui/skins/`).

## 3. Architecture & Core Concepts

### File Structure
- `src/main.ts`: Entry point. Bootstraps the game.
- `src/config/MasterConfig.ts`: Central configuration registry.
- `src/core/`: Core engine systems (Game loop, SceneManager, Input, Audio).
- `src/core/ecs/`: The ECS implementation.
    - `Components`: Pure data containers (e.g., `TransformComponent`, `HealthComponent`).
    - `Systems`: Logic processors (e.g., `PhysicsSystem`, `RenderSystem`).
    - `Entities`: ID wrappers composed of components.
- `src/entities/`: Game object factories/wrappers (Player, Enemy, Projectile).
- `src/ui/`: UI logic and Skin system.

### Architectural Invariants (Strict Rules)
Refer to `ARCHITECTURAL_INVARIANTS.md` for the complete list. **These must be respected.**
1.  **ECS Source of Truth:** `TransformComponent` (x, y, rotation) is **only** modified by `PhysicsSystem`. All other systems/classes must only **read** these values.
2.  **Logic/Render Separation:** Systems (except `RenderSystem`) must **not** access the DOM or Canvas Context. This ensures the logic can run "headless" if needed.
3.  **Component Purity:** Components must contain **only data**. No methods or complex logic.
4.  **Fixed Timestep:** Physics and movement must occur in a deterministic fixed step (managed by `PhysicsEngine` or `Simulation`).
5.  **Asset Pathing:** Always use `import.meta.env.BASE_URL` for asset paths.

## 4. Development Workflow

### Standard Commands
- **Start Development Server:** `npm run dev`
- **Build for Production:** `npm run build`
- **Preview Build:** `npm run preview`

### User-Specific Workflow (Memory)
- **Backend Server:** The user runs the backend server (likely the Vite server or a separate signaling server) in a **separate terminal**. Do not attempt to run it yourself; instead, provide the command if necessary or assume it is running.
- **Task Completion:** Do not mark tasks as "done" prematurely. The user prefers automatic completion but with high accuracy.
- **Interaction:** You can assume the server is running and interact with it (e.g., via `curl` if applicable, though this is primarily a client-side game).

## 5. Assets & Modding
- **Assets:** Located in `public/assets/`.
- **UI Skins:** Located in `src/ui/skins/`. New looks can be added by creating a folder here with `styles.scss` and assets.
- **Modding:** `MasterConfig.ts` handles game variables. New variables added here automatically appear in the Settings menu.

## 6. Directory Map (Key Files)
- `ARCHITECTURAL_INVARIANTS.md`: **CRITICAL**. Read before making architectural changes.
- `ASSETS_AND_MODDING.md`: Guide for adding art/audio.
- `src/core/Game.ts`: The main game loop and initialization.
- `src/core/MultiplayerManager.ts`: Handles PeerJS connections and message routing.
- `src/core/ecs/EntityManager.ts`: Manages entity lifecycles.
