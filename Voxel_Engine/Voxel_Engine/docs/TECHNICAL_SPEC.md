# Voxel Toy Box: Technical Specification

This document details the architectural constraints, generation pipelines, and optimization strategies for the Voxel Toy Box application.

## 1. Physical & Spatial Restrictions

To ensure high-performance rendering and stable physics simulations, the following restrictions are enforced:

### Voxel Count (Density)
| Limit Type | Value | Context |
| :--- | :--- | :--- |
| **Ideal Range** | 150 – 600 | Targeted by the Gemini System Instruction for optimal "toy-like" detail. |
| **Physics Cap** | ~2,500 | Above this threshold, CPU-based collision and rebuilding calculations may cause frame drops. |
| **Render Cap** | 10,000+ | The `InstancedMesh` system can visually handle many more voxels than the physics engine can simulate. |

### Spatial Dimensions
*   **Coordinate System:** Right-handed (Three.js standard).
*   **Ground Plane:** 200x200 units, positioned at `y = -12`.
*   **Bounding Box:** The visual "sweet spot" is a **40x40x40** cube centered at `(0, 0, 0)`. 
*   **Vertical Headroom:** Models are requested to start at `y = 0` (floating 12 units above the floor) to allow for dramatic "dismantle" animations.

---

## 2. Generation Pipeline

The transformation from a text prompt to a 3D physical structure follows a strict asynchronous pipeline:

### Step 1: Context Injection
The user's prompt is wrapped in a high-priority System Instruction.
*   **Create Mode:** Focuses on structural integrity and artistic flair.
*   **Morph Mode:** Injects the current scene's color palette into the prompt, instructing Gemini to "reuse" existing materials.

### Step 2: Inference & Schema Enforcement
We utilize `gemini-3-pro-preview` with a strict `responseSchema`.
*   **MIME Type:** `application/json`
*   **Output Format:** `Array<{ x: int, y: int, z: int, color: hex_string }>`
*   **Constraint:** The model is instructed to ensure "connectivity" (no floating debris) to prevent physics-induced scattering.

### Step 3: Voxel Engine Integration
1.  **Parsing:** Hex strings are converted to `THREE.Color` objects.
2.  **State Transition:** 
    *   **Create:** The existing `InstancedMesh` is disposed of, and a new one is initialized instantly.
    *   **Morph:** A greedy color-matching algorithm maps the $N$ existing voxels to the $M$ new target coordinates.
3.  **Animation:** The `VoxelEngine` uses a timestamp-based linear interpolation with a "per-voxel delay" based on height ($y$) to create the sweeping "rebuild" effect.

---

## 4. Optimal Prompt Engineering

For the most reliable and aesthetically pleasing results, prompts should follow the **"SSC" (Structure, Style, Color)** framework.

### Recommended Keywords
*   **Structure:** "Connected," "Symmetrical," "Solid base," "Thick-walled."
*   **Style:** "Voxel art," "8-bit style," "Lego-like," "Low-poly blocks."
*   **Color:** "High contrast," "Vibrant," or specific palettes like "Pastel" or "Neon."

### Example of an Optimal Prompt
> "A symmetrical red and white lighthouse with a solid grey base, voxel art style, 30 blocks tall."

---

## 5. Performance Considerations

*   **Instanced Rendering:** Every voxel is a single instance of a shared `BoxGeometry`. This reduces draw calls to **1 per scene**, regardless of voxel count.
*   **CPU Physics:** Gravity and collisions are calculated on the main thread. To keep the UI responsive, these calculations are optimized using simple Y-axis floor clamping rather than complex mesh-to-mesh collision.
*   **Memory Management:** The engine explicitly disposes of geometries and materials when switching models to prevent memory leaks during long sessions.
