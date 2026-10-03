# HomeForge AI — Requirements Checklist

Source: [MASTER_PROMPT.md](MASTER_PROMPT.md) (74 sections; the same text as `Home_design_features.txt`).
Status: `[x]` done and verified · `[~]` done with a stated limit. Every item is real functionality (§68).
Verification: `npm test` (27 unit tests), `e2e/tour.py`, `e2e/wizard.py` and `e2e/final_scenario.py` (Playwright, §72 end to end).

## Product & platform

- [x] §1 HomeForge AI with subtitle; full workflow; everything editable after generation
- [x] Design dashboard (home): plot and requirements setup, generate designs in place, live 3D hero (orbit, exterior, interior, top; day, sunset, night), rendered 2D plans and 3D cut-away, design strip with Select, finishes with room preview and photo upload, room customisation and resize, drone and walkthrough tours, sketch tools, links to every tool
- [x] Pro workspace: tools and layers sidebar, 2D plan and 3D side by side, floor, material, recent-project and assistant dock, properties panel
- [x] §2 Electron desktop app; autosave; offline-first; local storage; quality Low/Medium/High/Ultra; runs on software WebGL at Low (slow without a GPU)
- [x] §66 Modules: core/ planner/ editor/ engine/ ai/ render/ export/ storage/ modes/ dialogs/ workspace/
- [x] §71 Disclaimer on home, plan, title blocks, presentation, project export

## Plot & requirements

- [x] §3 Presets 3/5/7/8/10/12/15 Marla, 1/2/4 Kanal; custom ft/in/m/cm; irregular plots; area in sq ft, m², marla, kanal
- [x] §4 Wizard: plot, floors (7), rooms (23), outdoor (14), special (15), style (13, with real finish swatches), preferences (9)
- [x] §22 Text → structured requirements (offline parser; Claude structured output optional) → designs

## Generation engine

- [x] §5 Designs A–E with walls, rooms, doors, windows, stairs, columns, parking, garden, patio, baths, kitchen, furniture
- [x] §6 Constraint engine (structural, functional, environmental, privacy zones)
- [x] §45 "Why this design?"
- [x] §55 Pipeline stages shown while generating
- [x] §56 Validation list in the Issues tab; zero errors on the §72 house before and after edits
- [x] §24 Alternatives (9 variations) side by side
- [x] §61 Compare two designs or two versions
- [x] §62 Ten templates
- [x] §8 Parametric resize keeps neighbours connected (regression-tested); floor height drives 3D and stairs; bedroom count regenerates

## 2D editor

- [x] §7 All 14 tools; draw/move walls, add/resize/split/merge/delete rooms, doors/windows, columns, stairs, furniture, dimensions; snapping grid/walls/objects/guides/dimensions
- [x] §30 Dimensions for rooms, walls, doors, windows
- [x] §31 Measure tool and automatic area summary
- [x] §57 Beginner / Advanced
- [x] §58 Nine layers
- [x] §59 Grid presets and custom grid
- [x] §60 Smart labels and rename
- [x] §43 Selection details with direct editing

## Sketch & recognition

- [x] §19 Sketch → clean plan → Generate 3D; sketch can redraw a floor or add rooms to it (snaps to existing walls)
- [~] §20 Mouse, pen (pressure), touch, imported photo; walls, rooms, doors (gaps and arcs), windows (double lines, "W"), typed labels and "12x14" dimensions; asks "Did you mean this to be a bedroom?". Handwritten label text is not read; type labels with the Label tool
- [~] §21 Plan image → walls → rooms → doors → windows → scale → editable plan → 3D. Dimension text in the image is not read; the user enters the overall width

## 3D

- [x] §9 Full 3D from the model; orbit, pan, zoom, walk, enter rooms, camera height
- [x] §10 Realistic, Architectural, Dollhouse, Floor, Exploded; Morning/Noon/Afternoon/Sunset/Night lighting
- [x] §11 Drone routes, play/pause/restart/speed/height/path, WebM video
- [x] §12 WASD/arrows/gamepad walkthrough with collisions and stairs
- [x] §35 Sun by time, latitude, season, north; interior and exterior lights with colour temperature
- [x] §36 Orbit, top, front, back, left, right, street, facade, interior, room, drone, first person; bookmarks
- [~] §50 On-demand rendering, per-floor rebuilds, instancing, worker texture generation, lazy loading, quality presets. No GPU texture compression (KTX2) and no mesh LOD levels

## Materials

- [x] §13 Upload → analysis → "Apply this material to the selected surface?" Yes/Cancel → applied to floors, walls, ceilings, stairs, columns, counters, exterior, roof, site
- [x] §14 Type, pattern, colours, roughness, reflectivity, scale; seamless colour, normal, roughness and height maps; scale/rotation/offset/roughness/reflection/brightness/contrast/relief
- [x] §15 Before/after slider after every apply
- [x] §16 Library of 90+ materials in 15 categories plus My materials

## Rooms, furniture, outdoor

- [x] §17 Room designer for every room type, garages and gardens
- [x] §18 Furniture categories with move/rotate/resize/duplicate/delete
- [x] §25 Basement, ground, first, second, roof, "3D all", hide/show
- [x] §26 Basement rooms, light well, always-lit basement
- [x] §27 Seven stair types with width, steps, tread, material, railing
- [x] §28 Garage 1–4 cars, porch or enclosed, storage, workshop, EV charger
- [x] §29 Lawns, trees, plants, flowers, walkways, patio, pergola, seating, pool, fountain, BBQ, boundary wall, gates

## Drawings, estimates, export

- [x] §32 Floor, dimension, furniture, electrical, lighting, site, roof plans; elevations; sections (A3 sheets with title block)
- [x] §33 Live elevations; facade, windows, doors, balconies, columns, cladding, colours, lighting, roof editing
- [x] §34 Text request edits the real 3D model
- [x] §46 Cost estimate, five regions, editable rates, marked approximate (chart colours validated)
- [x] §47 Quantities
- [x] §48 PNG, JPG, PDF, SVG, DXF, OBJ+MTL, glTF, GLB, WebM, .homeforge

## AI

- [x] §23 All spec sentences become model edits (unit-tested)
- [x] §44 Assistant reports changes, moved rooms, new sizes and area changes; undo; regenerate
- [x] §53 The structured model is the source of truth
- [~] §54 Concept images are kept on a separate board and labelled; they are captured renders or imported photos (no image-generation model is bundled)

## Project, history, UX

- [x] §37 Project saves everything; autosave
- [x] §38 Versions: create, restore, duplicate, compare
- [x] §39 Undo/redo for every change
- [x] §40/§69 Dark and light themes, tooltips, context menus, shortcuts
- [x] §41 Menu bar, left toolbar, canvas, inspector, status bar
- [x] §42 Nine modes; switching is lossless
- [x] §49 Presentation: facts, renders, plans, 3D, interiors, materials; PDF export
- [x] §51 Errors explain what, why and how to fix, with retry; autosave before expensive operations
- [x] §52 Stable prefixed IDs
- [x] §63 First run: Create / Open / Try demo
- [x] §64 Shortcuts
- [x] §65 `.homeforge` zip with model, assets, thumbnail
- [x] §70 Non-expert flow
- [x] §72 Final scenario passes end to end (`e2e/final_scenario.py`)
- [x] §74 Build → run → test → fix at every milestone; Windows installer via `npm run dist`
