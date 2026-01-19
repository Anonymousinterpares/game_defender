General Logic for Wall Types
  The material logic is driven by the MATERIAL_PROPS registry and the HeatMap.update loop.


  ┌───────────────┬──────────┬───────────────┬─────────────────────────────────────────────────────────────────────────┐
  │ Material      │ Flamm... │ Vaporize T... │ Special Behavior                                                        │
  ├───────────────┼──────────┼───────────────┼─────────────────────────────────────────────────────────────────────────┤
  │ WOOD          │ Yes      │ 1.0s          │ Ignites at >0.6 heat. Fire spreads and deals 10 HP/s damage.            │
  │ METAL         │ No       │ 5.0s          │ Melting: At >0.5 heat, leaks molten metal into empty adjacent sub-ti... │
  │ BRICK         │ No       │ 10.0s         │ High durability; requires sustained max heat to destroy.                │
  │ STONE         │ No       │ 15.0s         │ Highest durability; slowest to vaporize.                                │
  │ **INDESTRU... │ No       │ 999k+ s       │ Immunity to all thermal destruction.                                    │
  └───────────────┴──────────┴───────────────┴─────────────────────────────────────────────────────────────────────────┘


  *\*Vaporize Time: Duration of exposure to >0.95 heat required for sub-tile destruction.*

  Specific Material Logic Details:
   * Metal Melting: When a Metal sub-tile is hot (>0.5) but not yet destroyed, it acts as a "source" that generates
     molten metal. This molten metal flows into "empty" space (where a wall was destroyed or never existed). If it cools
     down (<0.2 heat), it "bakes" into the ground, creating a permanent decal.
   * Vaporization (All Materials): Any material (except Indestructible) will eventually "boil away" if subjected to White
     Heat (>0.95) for long enough. When Metal vaporizes, it immediately converts into a full molten puddle at that
     location.
   * Boundary Integrity: Per Invariant F, all heat, fire, and destruction logic automatically terminates at the world
     boundaries to prevent simulation "leaks."