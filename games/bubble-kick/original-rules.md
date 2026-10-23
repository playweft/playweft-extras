# Football02 original-rule evidence

Checked 2026-10-24. This file separates verified original data from recreation tuning. No original binary, map, artwork or Python resource is shipped.

## Sources

- [2015 original-player guide](https://jingyan.baidu.com/article/da1091fb307e80027849d680.html): banana slide, slow glue, three shoe levels, normal/football blast ranges and immovable stacks.
- [2021 original football02 recording](https://www.bilibili.com/video/BV1Ji4y1P7ZE/): field layout, side lanes, continuously shrinking wave intervals.
- [Pinned reverse-engineering implementation](https://github.com/kuuhaku1314/qqtang/tree/4b3a245fd985cabd4abd68ade6c282cc163d9edb): scene-element pickup grants, movement status rates, native recycling handler.
- [Public v1.3.4 reference release](https://github.com/kuuhaku1314/qqtang/releases/tag/v1.3.4): `QQTang-Local.zip`, statically examined `Client.exe`, `bomb02_8.map`, and `mapElem.py`. The executable was disassembled, never run. Native addresses below refer to this executable.

SHA-256 for reproducibility:

| Extracted reference | SHA-256 |
| --- | --- |
| Client.exe | `670af4f24b3db6bac030a61d628cedc8e4522468f4ef4cb88a2239ad6b946f74` |
| bomb02_8.map | `02525f2e0603906063ef7115929cc4b28cfb37c0088bf5e2eb7308dcc8a2efcc` |
| mapElem.py | `6bbc353501dcaadb5af4d8007dc250b3532a7abb603a7a98f6eb74beea6b314f` |

## Field and goals

The native map is 15 columns × 13 rows. Football02's lawn occupies columns 1–13, rows 4–12: 13 × 9 cells after cropping the crowd and cones. Goal elements 7007/7008 begin at native row 7, columns 1/13; each covers 1 × 3 cells. Their `GridAttr=(0,0,0)` blocks actors and flames and excludes drop placement. In cropped coordinates this is columns 0/12, rows 3–5. Rows 0–2 and 6–8 on those outer columns are open lawn.

The player body uses a 0.475-cell half-width, matching native movement function `005b7d1b`. Static examination of that function confirms leading-edge points at centre ±`0x13` (19) pixels in all four directions, divided by `0x28` (40) to select collision cells. The width between those probe extremes is 38 pixels, or 0.95 cell. Sprite artwork is not the collision box.

Goal collision expands the full cell footprint by that body width. Next to the left goal, a player's centre stops at cropped x=0.975, only 0.025 cell from the neighbouring stripe's centre x=1; the previous 0.28 half-width incorrectly allowed x=0.78, visibly off centre. The right side and goal top/bottom use the same rule. Outer lawn lanes retain their existing centre endpoints x=0/12. Movement remains continuous and supports positions between stripe centres; stripe markings do not cause snapping. Native per-update endpoint and corner correction details are still simplified by the recreation's continuous sweep. Goal rendering uses the same terrain footprint. Bomb fall and kick destinations must be valid terrain, but can overlap other bombs (which creates an immovable stack).

## Football kick: corrected producer identification

The football contact producer is `0060cf49`, which sends `REQUEST_MOVE_BOMB` (`0x0FB4`) and receives `0x139C`. This is independently distinguished from the `PLAYER_THROW_BOMB` (`0x1159`) path by [the client-patch author](https://github.com/kuuhaku1314/qqtang/blob/4b3a245fd985cabd4abd68ade6c282cc163d9edb/internal/tooling/clientpatch/platform_effects.go#L94-L101). Earlier notes cited `006192ba–0061946d`, a separate throw path; that was the wrong evidence for football contact kicks.

Static checks of `0060cf49` show:

- `0060cfc9–0060cfec`: the contact point is 22 pixels ahead of the actor, along its facing direction. The centre must cross into the adjacent cell with this probe before sending a kick.
- `0060d083–0060d0ce`: exactly one grounded bubble is required; native special scene IDs 11/12 are excluded. Stacks cannot be kicked.
- `0060d0e7`: the starting distance is 8 for **both** axes, measured from the source bubble cell.
- `0060d0ee–0060d117`: destination column wraps modulo 15 and row modulo 13.
- `0060d126–0060d13f`: if a static map element occupies that target, decrement the distance, trying 7 down to 1. There is no forward search through 9–14.

With the football02 crop offset (1,4), a bubble at (3,4) kicked right reaches (11,4), eight cells away. Kicked down from the same source, its eight-cell target wraps into the terrace; the first valid fallback is (3,8), four cells away. This explains effective horizontal/vertical distance differences without inventing separate base distances.

Regression coverage checks every valid source cell and direction: 111 × 4 = 444 rays against a separately constructed native map mask.

## Fresh wave items

Native `005e17c5` checks the airborne wave gate; `005e19fb` returns one ordinary item while stock remains. `0061988b` dispatches the wave's bombs and ordinary items together. Items therefore use the bomb wave's entry time and cadence; no separate 14-second shield timer remains.

`005e1aad` builds this football02 pool; `005e18e3` samples by weight and decrements stock:

| Kind | Native scene ID | Weight | Initial stock | Effect |
| --- | --- | --- | --- | --- |
| Shoes | 3 | 5 | 50 | Immediate speed increase, maximum three levels |
| Banana | 23 | 2 | 50 | One placement, action 42 |
| Glue | 25 | 2 | 50 | Three placements, action 43 |
| Fork | 24 | 1 | 4 | One self-rescue, action 63 |
| Coin | 81 | 2 | 50 | Omitted at the user's request |

The original excludes coins during its opening 10 seconds. This version excludes them throughout and renormalizes the remaining weights. The map-specific dart entry (scene 27) is only installed for football03/04, so is absent on football02.

Slow lasts 10 seconds, using native movement rate 2 (projected here as 1.8 cells/s). Banana sliding uses rate 10 (13 cells/s), clears slow, holds the entry direction and stops when blocked. Existing placement overlap is allowed until leaving; re-entry can affect the owner. The common base movement rate is 204 pixels/s = 5.1 cells/s; shoe levels use 5.8/6.7/8. Held action counts saturate at the native byte maximum 255, not the previous recreation cap of 99.

## Recycling and remaining approximations

`005e280c` checks a 30-second dispatch gate for destroyed items (rule4 has a separate 15-second case). Recycled placed hazards remain placed hazards rather than granting new inventory stacks. This version retains that distinction and the 30-second gate, but uses a simplified queue and shared 0.8-second fall. The native bird path, delayed queue split, exact visibility latency and full original RNG are not reproduced.

The continuous wave threshold and counts use the scene clock, including Ready/Go. This fixes the previous extra three-second delay introduced by subtracting the opening countdown. The initial dispatch at approximately scene second 5 and the 0.8-second fall fit the 2021 recording; the producer's exact initial counter still needs independent confirmation. The four-minute scene deadline is verified in the native rule registry and the original recording, whose timer already counts down during Ready/Go.

## Full rule audit (2026-10-24)

This is a check of the supported football02 mode, not a claim of complete native emulation.

| Rule | Native evidence | Current status |
| --- | --- | --- |
| Lawn, goal occupancy and vertical stripes | Extracted map/resource plus original recording | Aligned: 13 × 9 lawn, solid 1 × 3 goals, walkable upper/lower lanes |
| Movement body | `005b7d1b`: ±19 pixels on 40-pixel cells | Aligned 0.95-cell footprint |
| Basic and shoe speeds | [Native scalar table](https://github.com/kuuhaku1314/qqtang/blob/4b3a245fd985cabd4abd68ade6c282cc163d9edb/internal/game/battleengine/types.go#L75-L80) | Fixed base 5 → 5.1 cells/s; shoes 5.8/6.7/8 |
| Contact-kick probe | `0060cf49`, ±22 pixels | Fixed: probe before movement, independent of ±19 body geometry |
| Kick distance/wrapping/fallback | `0060d0e7–0060d13f` | Fixed: both axes 8, modulo 15/13, shorten only |
| Flight | [Native bomb state](https://github.com/kuuhaku1314/qqtang/blob/4b3a245fd985cabd4abd68ade6c282cc163d9edb/internal/game/battleengine/types.go#L577-L590) | 400 ms; fuse retained; natural expiry waits for landing; explicit chains can include airborne destinations |
| Fuse | Native 3000 ms plus `005df7d0` strict negative check | Fixed 2.7 s → 3 s; next 20 ms frame is 3.02 s |
| Ordinary blast reach | Guide, native property 2/5 → one/four cells | Aligned; goal bodies stop arms |
| Short bubble shielding a long arm | `005d476f`, [native reach routine](https://github.com/kuuhaku1314/qqtang/blob/4b3a245fd985cabd4abd68ade6c282cc163d9edb/internal/game/battleengine/native_scene_lifecycle.go#L184-L220) | Fixed: arm stops at the next registered bubble; that bubble contributes its own reach |
| Blast impact versus visual foam | [Actor-hit routine](https://github.com/kuuhaku1314/qqtang/blob/4b3a245fd985cabd4abd68ade6c282cc163d9edb/internal/game/battleengine/actor_state.go#L72-L109) | Fixed: centre-cell hit only at impact; 500 ms foam does not repeatedly hit later entrants or later drops |
| On-hit movement modifier and facing | `005acaab`, native resetActorOnHit | Clear slow/slide and face down |
| Match clock and wave epoch | [Native rule 2 deadline](https://github.com/kuuhaku1314/qqtang/blob/4b3a245fd985cabd4abd68ade6c282cc163d9edb/internal/game/mapdata/catalog.go#L130-L135), original Ready/Go recording | Fixed 3 → 4 minutes, including countdown; waves use this same scene clock |
| Wave threshold and ordinary counts | `005e17c5`, `005e181c`, `005e183a` | Aligned formula and caps; first dispatch still an approximation |
| Item pool, weighted stock, pickup amounts | `005e1aad`, `005e18e3`, scene definitions | Aligned four retained item types, one per wave; glue ×3; action count cap fixed to 255 |
| Slow and banana status | Native movement rates and status lifetime | Slow 10 s at 1.8 cells/s; slide 13 cells/s, clear slow, hold direction until blocked |
| Recycling | `005e280c` | 30 s gate aligned; bird route, visibility delay and queue split remain simplified |
| Rescue/enemy contact | `0060c148` compares each axis strictly against 41 px, through the native DiffGrid path | **Intentional user override:** continuous Euclidean radius 0.75 cell, without a cell-transition gate |
| Coins | Native pool scene 81 | **Intentional user override:** omitted throughout |
| Corner correction | Native ±19 leading-edge probes, 6-pixel special tolerance, 25 ms projection | Still approximated by 20 ms continuous sweeps and 4-cell/s edge assistance; not pixel-identical |
| Trap expiry / post-rescue protection | Exact animation-driven native expiry not independently recovered | Retained recreation values 4 s / 1.2 s; not certified native constants |
| Large special bubbles | `005e1856`: after scene 120 s, random value mod 1000 selects 3 at 100, 2 at 201–202, 1 at 300–304 | **Not implemented.** Their special blast geometry is not guessed from ordinary power |
| Inventory scatter on death | Native death/drop path | **Not implemented.** Current eliminated players do not scatter inventory |
| Cached chain graph | `005d388a/005d3a9d` retain registration-time relations | Still approximated by current bubble positions; rare intervening-bubble insertion histories may differ |
| RNG, drop paths, spawn selection | Native producer plus bird path | Seeded recreation RNG, shared 0.8 s fall and fixed four-seat starts; exact native random sequence and spawn selection not reproduced |
| Other maps, Boss, extra avatars | Native maps/rules beyond football02 | Outside the supported mode |

JavaScript and Lua tests cover corrected timing, short/long blast shielding, airborne chain triggers, visual-foam entry, inventory saturation, exact scene deadline and all kick directions. Numerical values marked as approximations above must not be described as fully aligned with the original.
