# Voxel Toy Box: Under the Hood

This document provides a deep technical breakdown of the systems powering the Voxel Toy Box.

---

## 1. The Voxel System: High-Performance Instancing

Standard 3D engines often struggle with voxel scenes because creating a unique `Mesh` for every cube (e.g., 500 cubes = 500 draw calls) creates a massive bottleneck for the CPU and GPU.

### General Overview
We use **Geometry Instancing**. This technique tells the GPU to render one geometry (a cube) many times in a single operation, with different transformations (position, rotation, color) for each instance.

### Specific Implementation
*   **The Buffer:** We use `THREE.InstancedMesh`. It acts as a single container for all voxels.
*   **The Scratchpad (Dummy):** Because updating thousands of matrices directly is error-prone, we use a single `THREE.Object3D` named `dummy`. 
    ```typescript
    // In VoxelEngine.ts -> draw()
    this.dummy.position.set(v.x, v.y, v.z);
    this.dummy.rotation.set(v.rx, v.ry, v.rz);
    this.dummy.updateMatrix();
    this.instanceMesh.setMatrixAt(index, this.dummy.matrix);
    ```
*   **Memory Management:** When a new model is loaded, we explicitly call `.dispose()` on the geometry and materials of the old `InstancedMesh` to prevent memory leaks in the browser.

---

## 2. The Physics System: State-Based Simulation

The physics in this app is a custom **Euler-integration particle system**. It does not use a rigid-body solver (like Cannon.js) to save on performance and complexity.

### Phase A: Dismantling (The "Break")
When you click **BREAK**, the engine switches to `AppState.DISMANTLING`.
1.  **Explosion:** Each voxel is given a random `vx, vy, vz` velocity vector.
2.  **Gravity:** In every frame of the `animate` loop, we subtract `0.025` from the vertical velocity (`vy`).
3.  **Floor Collision:** We check if `voxel.y < -12`.
    *   If true: `velocity.y *= -0.5`. This causes the "bounce" effect.
    *   Friction: `velocity.x` and `velocity.z` are multiplied by `0.9` on every bounce to eventually come to a stop.

### Phase B: Rebuilding (The "Morph")
Rebuilding uses a **Greedy Color Matching Algorithm** to ensure the transition looks magical.
1.  **The Hunt:** For every *target* coordinate in the new model, we look at the *available* voxels on the floor.
2.  **Color Distance:** We calculate the difference between the target color and available voxel colors using a weighted RGB formula:
    `distance = sqrt(ΔR*0.3 + ΔG*0.59 + ΔB*0.11)`
3.  **Mapping:** The voxel with the smallest "color distance" is assigned that target coordinate.
4.  **Interpolation:** We use **Linear Interpolation (Lerp)**. Voxels don't just jump; they move `12%` of the remaining distance to their target every frame (`speed = 0.12`).

---

## 3. The Lighting & Environment System

The "Toy Box" aesthetic relies on high-contrast lighting to make the cubes feel like physical plastic objects.

### The Studio Setup
*   **Key Light:** A `DirectionalLight` positioned at `(50, 80, 30)`. 
    *   **Shadows:** We use `PCFSoftShadowMap`. This creates "soft" edges on shadows, preventing the scene from looking too harsh or "early-2000s 3D."
    *   **Shadow Camera:** We constrain the shadow camera to a `-40` to `40` frustum to focus all shadow resolution on the center of the stage.
*   **Fill Light:** An `AmbientLight` at `0.7` intensity. This ensures that even the dark side of a voxel still shows its color clearly.

### The "Horizon Blur" Trick
To make the UI feel integrated with the 3D world:
1.  **Tailwind Sync:** The CSS background color is `#f0f2f5` (Slate-100).
2.  **Three.js Fog:** `scene.fog = new THREE.Fog(0xf0f2f5, 60, 140)`.
3.  **Result:** Objects further than 60 units start to fade into the background color. At 140 units, they are invisible. This makes the floor plane appear infinite without actually rendering an infinite plane.

---

## 4. The AI Intelligence Layer

The Gemini 3 API is the "Architect." It doesn't know about Three.js; it only knows about the **JSON Protocol** defined in `App.tsx`.

### The System Instruction
We tell Gemini: *"Return ONLY a JSON array of objects with x, y, z, and color."*

### The Morphing Context
In `morph` mode, we query the `VoxelEngine` for its current unique colors and feed them back to Gemini:
`"Current palette: [#FF0000, #00FF00...]. PREFER these colors."`
This creates the illusion that the AI is intelligently choosing how to rearrange the specific blocks currently on the floor.