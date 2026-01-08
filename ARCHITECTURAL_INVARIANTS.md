# Architectural Invariants & Project Standards

This document defines the core constraints and standards for the codebase. All future modifications and features must adhere to these rules to ensure system stability, performance, and modularity.

---

## 1. ECS (Entity Component System) Mandates

### Invariant A: Single Source of Truth for State
*   **Rule**: If an entity possesses a `TransformComponent`, its `x`, `y`, and `rotation` MUST ONLY be modified by the `PhysicsSystem`.
*   **Legacy Exception**: Classes inheriting from `Entity` (e.g., `Player`) may *read* these values for logic, but MUST NOT write to them outside of the designated ECS System flow.
*   **Goal**: Prevent "fighting" between different systems and legacy `update()` loops.

### Invariant B: Logic/Rendering Separation
*   **Rule**: ECS Systems (with the exception of `RenderSystem`) MUST NOT access the `CanvasRenderingContext2D` or any DOM elements.
*   **Goal**: Enable "headless" execution for multiplayer servers and deterministic logic testing.

### Invariant C: Component Purity
*   **Rule**: Components MUST contain only raw data and flags. No methods, no complex logic, and no references to other components.
*   **Goal**: Ensure data is serializable for multiplayer synchronization and cache-friendly.

---

## 2. Physics & Simulation Standards

### Invariant D: Deterministic Step (Fixed Timestep)
*   **Rule**: All movement and collision resolution MUST occur within the `PhysicsSystem` using a fixed `dt` (accumulator logic in `PhysicsEngine`).
*   **Goal**: Eliminate "tunneling" (passing through walls) and ensure identical behavior across different hardware/frame rates.

### Invariant E: Robust Collision Resolution
*   **Rule**: Collision checks MUST NOT rely on single-point sampling. They must use "Circle-vs-Tile" or "Shape-vs-Tile" resolution that checks the entire bounding area of the entity.
*   **Resolution**: Always resolve overlaps by pushing the entity out of the tile based on the shortest penetration vector.

---

## 3. World & Material Invariants

### Invariant F: Boundary Integrity
*   **Rule**: Heat, fire, and destruction logic MUST automatically skip tiles at the world boundaries (`tx <= 0 || tx >= width - 1`).
*   **Goal**: Prevent map "leaking" and ensure the simulation area remains contained.

### Invariant G: Material Determinism
*   **Rule**: A tile's properties (HP, Flammability) MUST be derived strictly from its `MaterialType`.
*   **Goal**: Simplify synchronization between client and server.

---

## 4. Coding Style & Safety

### Invariant H: No Silent Failures
*   **Rule**: Critical missing dependencies (e.g., a required component for a system) must be logged as warnings or errors immediately, rather than failing silently with `undefined` errors.

### Invariant I: Asset Pathing
*   **Rule**: All asset paths MUST use the `import.meta.env.BASE_URL` prefix to ensure compatibility with different deployment environments (GitHub Pages, local, etc.).
