# GPU Acceleration Roadmap: Neon Rogue

## Phase 1: Hybrid Wall Rendering (Static Batching)
- [ ] **1.1 WebGL2 Context & Layering**
    - Setup `GPUDriver` to manage a hidden WebGL2 canvas.
    - Implement context synchronization (ensure GPU canvas size matches 2D viewport).
- [ ] **1.2 Coordinate-Perfect Shader**
    - Port `ProjectionUtils.projectPoint` to GLSL.
    - Implement a `u_viewProjection` matrix to match the 2D canvas camera logic (camera center, zoom).
    - Support light-direction shading (Sun/Moon) in the fragment shader.
- [ ] **1.3 Static Geometry VAO**
    - Build a `VertexArrayObject` (VAO) containing all healthy wall segments.
    - Implement "Dirty Regions": Rebuild the VAO only when tiles change (destruction), not every frame.
- [ ] **1.4 Integration & Verification**
    - Integrate into `WorldRenderer.renderSides`.
    - **Verification:** Use a "Strobe Test" (toggle GPU/CPU every frame) to ensure 0-pixel deviation.

## Phase 2: GPGPU HeatMap (Simulation)
- [ ] Port the HeatMap's `update()` logic (cellular automata) to a Fragment Shader using dual-buffering (ping-pong textures).
- [ ] Read-back heatmap data for CPU-side logic (e.g., damage application) only when necessary.

## Phase 3: Instanced Entity Rendering
- [ ] Pack all machine segments and projectiles into a Texture Atlas.
- [ ] Use `drawElementsInstanced` to render all entities in a single draw call.
- [ ] Final transition: Move the main loop's "Composite" step to GPU, making the 2D canvas purely for UI.
