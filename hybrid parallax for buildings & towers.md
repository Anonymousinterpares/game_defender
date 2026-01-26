# 1. Defense Towers: The "Pedestal & Turret" System
For a dynamic tower like the one you shared, you split the object into two distinct layers that are kept in sync by the same math.

## The Pedestal (The Base):

## Representation:
This is a standard wall block (e.g., 1x1 tile) rendered by your existing 
GPUWallRenderer
.

## Configuration:
You set its height specifically for that tile (e.g., height: 64).

## Benefit:
This base automatically handles the parallax shifting and provides the physical "mass" of the tower. It also casts the large, static shadow based on its height.

## The Turret (The Weapon):

## Representation:
A 2D sprite (voxel art exported as a PNG) rendered on a separate "Entity Layer."

## Sync Logic:
To make the sprite look like it is physically attached to the top of the tower, you apply the exact same parallax shift to it that the wall renderer applies to the wall tops. As the camera moves, the turret sprite "slides" across the screen at the same rate as the tower base's top edge.

## Rotation:
Since it's a sprite, it can rotate 360 degrees independently to track enemies.

## Shadows:
For the barrel, you use a "Shadow Proxy" (Path A). A single line segment projecting out from the center based on the turret's rotation will create a narrow shadow that follows the gun's aim.

# 2. Advanced Buildings: The "Decorated Cuboid" System
To make rectangular buildings (energy plants, labs) look highly detailed while keeping them as cuboids, you use Detail Overlays.

## Custom Height Footprints:
Buildings aren't limited to 1x1. You can mark a 3x3 area of tiles as a single building.
You can mix heights: A main facility (32px high) could have a taller reactor (64px high) attached to its side.

## Side-Face Texturing (The "Skin"):
Currently, your wall sides are likely a solid color or a generic texture.
For advanced buildings, the shader can be told to use a specific Face Texture. Instead of a generic brick, it maps a "Power Plant Side" sprite onto that vertical parallax quad.
This "skin" can include painted-on pipes, windows, or glowing vents. Because it scales with the parallax, it looks like it has 3D depth.

## Roof-Top Props:
The "Roof" is a flat 2D plane on top of the tiles. You can render "Prop Sprites" on it (antennas, solar panels, cooling fans).
Just like the Turret, these props shift with the same parallax math, so they appear to be "riding" on top of the building.

## Summary of the "Perspective Trick"
The key to making this look "Pro" is ensuring that the Standard Wall, the Building Sides, and the Top Sprites all use the exact same perspective calculation:

## Logic:
Offset = (ObjectHeight) * (ObjectPosition - CameraCenter) * PerspectiveStrength
