# Professional transformation: progress log

Started 2026-11-08. This log is the working record for the "professional, production-grade" request. It lists what was planned, what is done, what was measured, and what is left. Read it first when resuming.

## Snapshot of the version before this work

| Where | What |
|---|---|
| git tag `v1.0-before-pro` (pushed) | Commit ec21105, "Remove the OpenGL graphics option" |
| git branch `backup/v1.0-before-pro` (pushed) | Same commit |
| `D:\HomeForge_backups\v1.0-before-pro\HomeForge-AI-Setup-1.0.0.exe` | The installer as built from that commit |
| `D:\HomeForge_backups\v1.0-before-pro\source.zip` | `git archive` of that commit |

To go back: `git checkout v1.0-before-pro`, or install the saved setup exe.

## The request, in priority order

1. **2D and 3D visualization (top priority).** The new Low preset must look at least as good as the old Ultra while staying smooth. Medium, High and Ultra must each add realism: sharper detail, better textures, physically based lighting, soft shadows and reflections.
2. **Rendering engine performance:** geometry, materials, lighting.
3. **AI design generation:** more accurate and practical layouts, better room proportions and space use, structural sense.
4. **UI/UX:** professional look, layout, navigation, controls and interactions.
5. **Keep every existing feature working.**

## Plan

| Phase | Scope | Status |
|---|---|---|
| P0 | Save the current version; start this log | Done |
| P1 | Rendering pipeline v2: idle progressive refinement (jittered supersampling, soft area-light shadows, AO), new preset table, tone mapping, texture resolution, accumulated snapshots | Done (first pass) |
| P2 | Material and geometry realism: texture maps, glass, wall and trim detail | Planned |
| P3 | 2D plan visualization: presentation-grade plan drawing | Planned |
| P4 | AI generator: many candidate layouts, each scored on proportions, adjacency, light, circulation and compliance; the best one is kept | Planned |
| P5 | UI/UX polish across the screens | Planned |
| P6 | Verify (unit, e2e, benchmarks), build the installer, commit and push | Planned |

## Baseline (old presets, before P1)

| Preset | Pixel ratio | Shadow map | Textures | Lights | Post (bloom) | AO | Anti-aliasing |
|---|---|---|---|---|---|---|---|
| Low | 1 | none | 256 | 4 | no | no | none |
| Medium | 1 | 1024 | 512 | 8 | no | no | MSAA |
| High | 1.5 | 2048 | 1024 | 8 | yes | no | FXAA |
| Ultra | 2 | 4096 | 1024 | 12 | yes | GTAO | FXAA |

## Log

### 2026-11-08
- P0 done: tag, branch, local backup, this log.
- Read `Engine.ts` in full. Key facts for P1:
  - Frames render on demand.
  - Shader compiles go through `ready()` per render path (`post` or `screen`).
  - `snapshot()` takes one frame, cropped from the canvas, or a resized frame when supersampled.

### 2026-11-08/09: P1 rendering pipeline v2

**What the baseline showed** (`test-results/visual/base`, harness `e2e/visual.py`, fixed house `e2e/fixtures/villa.json`):
- The old Ultra looked *worse* than Low in daylight: roofs and walls were covered in dark blotches. The cause was GTAO's own normal pass (`scene.overrideMaterial`, FrontSide), which skipped double-sided and reverse-wound faces and saw through roofs. It was not shadow acne.
- Low and Medium had no ambient occlusion and no bounce light. Interiors were lit by the sky environment as if they were outdoors (flat, bluish).

**New pipeline** (`src/renderer/src/engine/render/Pipeline.ts`): scene to HDR target with depth texture, then GTAO (normals reconstructed from that depth), then accumulation, then bloom, then tone mapping, then FXAA (moving frames only).
- **Still views refine.** Each sample has sub-pixel camera jitter (Halton) and the sun moved within a 0.7° disc, giving supersampled edges and soft area shadows. The AO noise pattern is offset per sample so its grain averages out. Samples per preset: Low 16, Medium 32, High 64, Ultra 128. Pictures use 12/16/24/40 samples.
- **Interior light probe.** When the view rests inside a room, a 128 px cube capture at the camera is filtered with PMREM and replaces the sky environment. This gives bounce light and reflections of the room in glossy floors. Interiors get a 1.35x photographic exposure lift.
- **Shadow map** is redrawn only when the house, layout or sun changes, or for a refinement sample, not on camera moves. It had cost about 20 ms per frame at 4096 px.
- **GPU fence:** one refinement sample in flight at a time. A backlog of samples had stalled the next camera move for up to 0.6 s.
- **Texture arrivals** blend into the refined picture (`Engine.refresh`, `Pipeline.soften`) instead of restarting it.
- **Bug fixed:** a background picture render restored a stale copy of the house, so the 3D view could lose an edit made meanwhile. Views now register `Engine.viewSync` (Viewport3D, Dashboard hero, Showcase live).

**Presets:**

| Preset | Pixel ratio | Shadow map | Textures | AO / bloom while moving | Still samples |
|---|---|---|---|---|---|
| Low | 1 | 2048 | 1024 | no / no | 16 |
| Medium | 1.25 | 2048 | 1024 | no / yes | 32 |
| High | 1.5 | 4096 | 1024 | yes / yes | 64 |
| Ultra | 2 | 4096 | 1024 | yes / yes | 128 |

All presets use soft PCF and anisotropy 16. Ultra at 2048 px textures took 20+ s of upgrades and stuttered, so it stays at 1024.

**Orbit smoothness, moving frames drawn** (old, then new; production build, same machine):

| Preset | Old fps | Old worst frame | New fps | New worst frame |
|---|---|---|---|---|
| Low | 59.8 | 21 ms | 59.4 | 38 ms |
| Medium | 58.4 | 175 ms | 59.0 | 69 ms |
| High | 59.6 | 30 ms | 54–57 | 0.2–0.77 s, one hitch |
| Ultra | 30.3 | 0.67 s | 48–51 | 0.67–0.74 s |

**Next for P1:** the one hitch on High and Ultra; night exteriors (window glow, facade lights).
