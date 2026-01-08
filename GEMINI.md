# Gemini Project Context: Modular Arcade Rogue-like

## Core Information
- **Project Name:** Modular Arcade Rogue-like
- **Tech Stack:** TypeScript, Vite, SASS, PeerJS (Multiplayer), WebWorkers (Parallelization).
- **Architecture:** Entity-Component-System (ECS) transition in progress. The `Simulation` class manages both legacy entities and the new ECS.
- **Rendering:** Canvas 2D API. Logic and rendering are strictly separated (Invariants).

## Key Architectural Principles (MUST RESPECT)
- **ARCHITECTURAL_INVARIANTS.md:** This file defines the core constraints. Always read and respect it.
- **Single Source of Truth:** `PhysicsSystem` is the only system allowed to modify `TransformComponent` (x, y, rotation).
- **Separation of Concerns:** ECS Systems (except `RenderSystem`) must not access Canvas or DOM.
- **Component Purity:** Components must be raw data only.
- **Deterministic Step:** Fixed timestep for physics and simulation.

## Known Critical Issues & Fixes
- **Multiplayer HeatMap Crash:** Fixed a crash where `HeatMap.update` accessed uninitialized heat data for ignited tiles. Ensure `heatData` is initialized before adding tiles to `activeTiles`.

## Project Structure
- `src/core/`: Engine core, Managers, and Scene management.
- `src/core/ecs/`: Custom ECS implementation (Components, Systems, EntityManager).
- `src/core/Simulation.ts`: The central hub for game logic, bridging ECS and legacy systems.
- `src/core/renderers/`: Dedicated rendering logic.
- `src/workers/`: WebWorkers for lighting and particles.
- `src/ui/`: UI components and menu scenes.
- `src/config/MasterConfig.ts`: Global configuration management.

## Useful Commands
- `npm run dev`: Start the local development server (Vite).
- `npm run build`: Type-check and build the project.
- `npm run preview`: Preview the production build.

## Agent Guidelines & User Preferences
- **Task Completion:** Perform tasks autonomously after confirmation. Do NOT mark a task as "done" unless it is fully verified.
- **Manual Verification Mode:** Prefer automatic completion but allow for manual verification if requested.
- **Invariants:** `ARCHITECTURAL_INVARIANTS.md` must ALWAYS be respected. Report any concerns about its content immediately.
- **Backend Server:** The user runs the backend server in a separate terminal. Do not attempt to run it; provide the command instead.
