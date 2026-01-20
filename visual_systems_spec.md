# Neon Rogue: Visual Systems Specification

This document provides an in-depth technical overview of the visual features, systems, and rendering pipelines of Neon Rogue.

## 1. Core Rendering Pipeline
The game currently utilizes a **Layered 2D Canvas Architecture** with an additive/multiplicative lighting pass.

### Pipeline Stages:
1.  **Ground Layer**: Cached 512px chunks of basic ground tiles.
2.  **Melted Snow Layer**: Batched `ImageData` patches for snow-free areas.
3.  **Entity Underlay**: (Projected shadows for characters and NPCs).
4.  **World Layer (Walls)**: Projected 3.5D wall geometry (sides and tops).
5.  **Entity Layer**: ECS-driven rendering of characters, projectiles, and drops.
6.  **Visual Overlays**: Heat glow, molten metal ripples, and active fire.
7.  **Lighting Pass**: High-intensity additive buffer multiplied with the world.
8.  **Atmospheric Layer**: Fog overlays, rain/snow particles, and screen flashes.

---

## 2. 3.5D World Projection System
The game simulates depth using a **Perspective Lean** algorithm.

### Algorithms & Formulas:
-   **Projection Formula**: Points are shifted based on their height ($Z$) and distance from the camera center.
    $$Offset_x = (x - center_x) \times (z / scale)$$
    $$Offset_y = (y - center_y) \times (z / scale)$$
-   **Wall Sides**: Rendered as quads connecting tile base $(x, y)$ to projected top $(v_x, v_y)$.
-   **Shading**: Flat Lambertian-style shading.
    $$Shade = \max(0, -LightDir \cdot WallNormal)$$
    Normals are fixed per wall face (Top: $0,-1$, Bottom: $0,1$, Left: $-1,0$, Right: $1,0$).

---

## 3. Advanced Heat & Destruction System
The HeatMap is a high-density grid (10x10 sub-tiles per world tile) managing thermal and structural state.

### Simulated Elements:
-   **Heat/Temperature**: Diffusion-based heat spread across the grid.
-   **Destruction (HP)**: Sub-tile health tracking. When $HP \le 0$, a "hole" is created in the wall geometry.
-   **Fire**: Cellular automata for fire spread and intensity.
-   **Molten Metal**: Persistent "puddles" that melt snow and damage entities.
-   **Scorching**: Surface decals indicating previous intense heat.

### Rendering Patterns:
-   **LUT (Look-Up Table)**: 256-color ramps for Heat (Black $\to$ Dark Red $\to$ Orange $\to$ Yellow $\to$ White) and Molten (Gold/Orange).
-   **Even-Odd Fill**: Used to render wall tops with "holes" by defining the outer boundary and then subtracting inner sub-tile hole quads.

---

## 4. Lighting & Shadows
Neon Rogue uses a sophisticated **Additive Lighting Pipeline**.

### Systems:
-   **Directional Lights (Sun/Moon)**: Global lights with moving shadow chunks. Shadows are projected flat on the ground.
-   **Point Lights**: Circular light sources with worker-calculated **Visibility Polygons** (2D Raycasting).
-   **Dynamic Silhouettes**: Each frame, walls and entities are rendered as black masks to punch holes in light cones, creating hard shadows.
-   **Additive Compositing**: All lights are rendered to a separate low-res buffer (`screen` operation) and then multiplied with the scene.

---

## 5. Particle & Weather Systems
The simulation is decoupled from rendering via **Web Workers** and **SharedArrayBuffers**.

### Visual Traits:
-   **Smoke**: Soft, low-frequency blobs responsive to wind. Rendered to a low-resolution buffer and blurred for an organic feel.
-   **Molten Shrapnel**: Arc-projected particles that "land" on the ground and create heat spots.
-   **Precipitation**: Parallaxed vertical lines (rain) or circular flakes (snow) with velocity-based stretching.
-   **Cloud Shadows**: Seamlessly tiling procedural noise patterns projected onto the terrain.

---

## 6. Visual Descriptive Traits
-   **Aesthetic**: Industrial / Cyber-grunge. High contrast between dark shadows and vibrant neon/fire lighting.
-   **Motion**: Snake-like smooth movement of the player, contrasted with aggressive erratic movement of NPCs.
-   **Atmosphere**: Oppressive and moody, with dynamic day/night cycles and shifting weather intensities.
