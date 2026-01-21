# GPU Mode Implementation Plan: Neon Rogue Evolution

This document outlines the strategy for introducing configurable GPU-accelerated rendering while maintaining the core CPU logic and fallback.

## Phase 0: The Hybrid Pipeline [COMPLETED]
Establish the infrastructure for switching between Canvas 2D and WebGL/WebGPU.

### Phase 0.1: Graphics Backend Facade [COMPLETED]
-   Introduce a `GraphicsContext` abstraction to wrap both 2D and 3D contexts.
-   Implement a dynamic switch in `MasterConfig` and `GameSettings` to toggle GPU mode.
-   **Success Criteria**: User can toggle GPU mode in settings and see a "GPU Active" status without visual regressions.

### Phase 0.2: Parallel Buffer Management [COMPLETED]
-   Sync CPU state (Entities, HeatMap) to GPU via Uniform Buffers / Textures.
-   Implement the first shader-based pass for the basic tiling world.
-   **Success Criteria**: World ground and walls render identically in both modes.

---

## Phase 1: High-Fidelity Simulation
Move the heaviest calculations to Compute Shaders (or optimized Vertex/Fragment shaders).

### Phase 1.1: GPU Particle System [COMPLETED]
-   **Simulation**: Move particle physics (gravity, wind, collisions) to the GPU.
-   **Smoke Dynamics**: Implement a grid-based fluid simulation for smoke/steam, allowing it to "flow" around entities and through holes.
-   **Success Criteria**: 100,000+ particles at 60 FPS with organic smoke movement.

### Phase 1.2: Thermal Field Simulation
-   Move HeatMap diffusion and Fire cellular automata to a shader.
-   Real-time "heat blur" and "heat distortion" effects based on thermal intensity.
-   **Success Criteria**: Smooth, non-pixelated heat gradients and realistic fire "flicker".

---

## Phase 2: Advanced Lighting & Shading
Exceed CPU limitations with high-end visual techniques.

### Phase 2.1: Deferred Lighting Pipeline
-   Implement a G-Buffer (Position, Normal, Albedo, Material).
-   Support hundreds of dynamic lights with soft shadows and Global Illumination (GI) probes.
-   **Success Criteria**: Realistic light bounce from fire onto walls and ground; smooth penumbra on shadows.

### Phase 2.2: Advanced Materials & Post-Processing
-   Add Normal Mapping to walls for textured stone/metal.
-   Specular highlights on molten metal.
-   Post-processing: Bloom, Chromatic Aberration, and Tonemapping.
-   **Success Criteria**: "Pro-game" visual quality with deep immersion.

---

## Phase 3: Multiplayer & Synchronization
Ensuring the GPU brilliance doesn't break game logic.

### Phase 3.1: Synchronized Visual Seeds
-   Sync random seeds for GPU-based noise (smoke/weather) to ensure visual parity with minimal data transfer.
-   **Success Criteria**: Host and client see smoke drifting in the same patterns.

### Phase 3.2: Deterministic State Verification
-   Ensure GPU-based "collision particles" do not affect game logic, keeping them strictly visual or verifying GPU results against CPU snapshots.
-   **Success Criteria**: Zero gameplay desyncs caused by visual simulations.
