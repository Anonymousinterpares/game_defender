# Assets & Modding Guide

## Directory Structure
The game uses a modular structure for assets and UI skins.

### UI Skins
Location: `src/ui/skins/`

To add a new look/skin to the game:
1. Create a new folder in `src/ui/skins/` (e.g., `src/ui/skins/retro-pixel/`).
2. Inside that folder, you should place your assets and style definitions.
3. Common expected files for a skin:
   - `styles.scss` - Skin-specific CSS overrides.
   - `assets/` - Folder for images (buttons, frames).
   - `layout.ts` - (Optional) Custom layout logic if the skin changes element positions drastically.

### Game Assets
Location: `public/assets/`

- `images/` - Sprites and textures.
- `sounds/` - Audio files.
- `fonts/` - Custom web fonts.

## Configuration
All gameplay variables are central in `src/config/MasterConfig.ts`.
- **Adding a new variable:** Simply add a new entry to the `MasterConfig` object following the `ConfigItem` schema.
- **Auto-loading:** The Settings menu will automatically detect the new variable and create a slider or checkbox for it. No UI code changes required!

## Physics & Logic
- `src/core/PhysicsEngine.ts` handles the movement.
- `src/entities/` should contain specific game object logic (Player, Enemies).
