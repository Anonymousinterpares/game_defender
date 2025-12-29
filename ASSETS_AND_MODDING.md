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

#### Images (`public/assets/images/`)
- `player_head.png` - The primary segment of the player's machine (Brass/Steampunk).
- `player_segment.png` - The trailing body segments/slots.
- `enemy_basic.png` - Rusted industrial drone sprite.
- `drop_coin.png` - Gear-shaped coin sprite.
- `drop_booster.png` - Cyan glowing crystal sprite.
- `projectile_yellow.png` - Standard bullet sprite.
- `turret_top.png` - Auto-tracking turret module sprite.
- `shield_bubble.png` - Translucent shield overlay texture.

#### Sounds (`public/assets/sounds/`)
- `ping.wav` - SONAR radar sweep detection sound (synthesized fallback exists).
- `shoot.wav` - Standard weapon fire sound.
- `collect_coin.wav` - Played when picking up gear/coins.
- `enemy_hit.wav` - Impact sound when projectile hits an enemy.
- `enemy_explode.wav` - Sound played upon enemy destruction.
- `ui_click.wav` - Standard button click sound for menus and the Engineering Dock.

#### Fonts (`public/assets/fonts/`)
- `steampunk_main.woff2` - Recommended for headers and UI.
- `terminal_font.woff2` - Recommended for HUD and status readings.

## Configuration
All gameplay variables are central in `src/config/MasterConfig.ts`.
- **Adding a new variable:** Simply add a new entry to the `MasterConfig` object following the `ConfigItem` schema.
- **Auto-loading:** The Settings menu will automatically detect the new variable and create a slider or checkbox for it. No UI code changes required!

## Physics & Logic
- `src/core/PhysicsEngine.ts` handles the movement.
- `src/entities/` should contain specific game object logic (Player, Enemies).
