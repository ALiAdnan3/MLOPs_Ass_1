# HomeForge AI — Requirements Checklist

Source: [MASTER_PROMPT.md](MASTER_PROMPT.md) (74 sections). Status: `[ ]` todo · `[~]` partial · `[x]` done & verified.
Re-read before each phase. Every item must be real functionality (§68: no fake buttons).

## Product & platform
- [ ] §1 Name "HomeForge AI", subtitle "Design. Generate. Customize. Experience Your Home.", full workflow, everything editable after generation
- [ ] §2 Desktop app (Electron), fast startup, low RAM, autosave, offline-first, local storage, no GPU required; quality Low/Medium/High/Ultra
- [ ] §66 Modular architecture: core/ planner/ editor/ engine/ ai/ render/ export/ storage/
- [ ] §71 Disclaimer: conceptual / preliminary, review by qualified architect/engineer

## Plot & requirements
- [ ] §3 Presets 3/5/7/8/10/12/15 Marla, 1/2/4 Kanal; custom length/width; ft/in/m/cm; irregular plots (advanced); auto area
- [ ] §4 Wizard 7 steps: Plot (size, W, L, road dir, north, corner) · Floors (7 options) · Rooms (23 types) · Outdoor (14) · Special (15) · Style (13) · Preferences sliders (9)
- [ ] §22 Text → structured requirements → designs

## Generation engine
- [ ] §5 Multiple designs (A Modern Family, B Luxury Open, C Privacy Focused, D Maximum Garden, E Maximum Room Space) with plot boundary, walls, rooms, doors, windows, stairs, columns, parking, garden, patio, baths, kitchen, furniture, dimensions, floor info — editable
- [ ] §6 Constraint engine: structural (wall thickness, columns, beams, stair space, floor heights, door/window sizes), functional (access, kitchen–dining, garage, stairs, corridors), environmental (light, ventilation, windows, courtyard), privacy zones
- [ ] §45 "Why this design?" explanation
- [ ] §55 Pipeline: requirements → structured → constraints → allocation → room graph → plan → validation → 3D → materials → lighting → camera → render
- [ ] §56 Validation: overlaps, invalid walls, disconnected rooms, blocked doors, impossible stairs, rooms without access, invalid dims, furniture outside rooms, bad windows, garage inaccessible, basement disconnected — shown as warnings
- [ ] §24 Generate alternatives (more garden/bedrooms/parking/privacy/light/luxury/open/modern/traditional) side by side
- [ ] §61 Compare two designs (stats + 2D/3D side by side)
- [ ] §62 Templates: 5M Modern, 5M Double Story, 10M Modern, 10M Luxury, 10M Basement, 15M Luxury, 1K Modern, 1K Luxury, 2K Estate, 4K Estate
- [ ] §8 Parametric: room width → resize; house width → adjust; floor height → 3D; bedroom count → regenerate

## 2D editor
- [ ] §7 Tools: Select Wall Room Door Window Column Stair Dimension Text Furniture Garden Pool Garage Patio; draw/move walls, resize/add/delete/split/merge rooms, move/resize doors & windows, add columns/stairs/furniture/dimensions; snapping grid/wall/object/guides/dimension
- [ ] §30 Dimensions for rooms (W, L, H, area), walls (L, T, H), doors (W, H), windows (W, H, sill)
- [ ] §31 Measure distance/room area/wall length/ceiling height/total floor/plot area; covered/open/floor/room/garage/garden area
- [ ] §57 Beginner vs Advanced modes
- [ ] §58 Layers: Architecture Structure Furniture Electrical Plumbing Landscape Lighting Materials Annotations (hide/show)
- [ ] §59 Grid 1in/3in/6in/1ft/custom + auto snap
- [ ] §60 Smart room labeling + rename
- [ ] §43 Object selection shows dims/area/floor/materials/ceiling/windows/doors/furniture/lighting, direct editing

## Sketch & recognition
- [ ] §19 Sketch mode: draw → clean plan → Generate 3D
- [ ] §20 Mouse / tablet / touch / imported sketch image; detect walls, rooms, doors, windows, labels, dimensions; low-confidence question "Did you mean this to be a bedroom?"
- [ ] §21 Floor-plan image → walls → rooms → doors → windows → dimensions → editable plan → 3D

## 3D
- [ ] §9 Generate 3D from walls/doors/windows/rooms/floors/roof/stairs/columns; rotate/pan/zoom/walk/enter rooms/camera height/look around/top/street/inside
- [ ] §10 View modes: Architectural, Realistic, Day, Evening, Night, Dollhouse, Floor, Exploded
- [ ] §11 Drone view: auto cinematic route (gate → house → facade orbit → roof → plot → backyard → entrance → living → dining → kitchen → upstairs → bedrooms); play/pause/restart/speed/height/path; video export
- [ ] §12 Walk inside: WASD + mouse, arrows, gamepad, collision
- [ ] §35 Lighting: sun direction, time of day, latitude, season, artificial/interior/exterior lights; presets Morning Noon Afternoon Sunset Night
- [ ] §36 Cameras: Top Front Back Left Right Street Interior Room Drone Orbit First-person + bookmarks
- [ ] §50 Performance: efficient scene graph, instancing, LOD, lazy loading, texture compression, cached geometry, GPU, efficient undo, background workers, no needless re-render

## Materials
- [ ] §13 Upload marble/granite/stone/tiles/wood/wallpaper/paint/brick/flooring/ceiling/kitchen/countertop/cladding; select surface → "Apply this material to selected surface?" YES/CANCEL → mapped
- [ ] §14 Analyze: texture type, tile pattern, color, roughness, reflectivity, scale; PBR maps base/roughness/normal/height/metallic; manual scale/rotation/offset/roughness/reflection/brightness/contrast
- [ ] §15 Before/After comparison slider for floors, walls, countertops, exterior walls, stairs, bathrooms, kitchens, columns
- [ ] §16 Library: Marble Granite Ceramic Porcelain Wood Concrete Brick Stone Paint Metal Glass Roof Wallpaper + "My Materials"

## Rooms, furniture, outdoor
- [ ] §17 Room designer: size, wall/floor material, ceiling, doors, windows, lighting, furniture, color, curtains, bed, wardrobe, TV, decorations — for all room types
- [ ] §18 Furniture categories (16) with move/rotate/resize/duplicate/delete
- [ ] §25 Floors: Basement Ground First Second Roof + selector incl. "3D ALL", hide/show
- [ ] §26 Basement first-class (lounge, theater, gym, game, storage, bedroom, bath, office, wine, laundry, mechanical, stair, light well) + basement lighting
- [ ] §27 Stairs: straight, L, U, spiral, floating, modern, traditional; width/height/steps/material/railing
- [ ] §28 Garage 1–4 cars; door, car positioning, storage, workshop, EV charger
- [ ] §29 Outdoor: grass, trees, plants, flowers, walkways, patio, pergola, seating, pool, water feature, BBQ, boundary wall, gate

## Drawings, estimates, export
- [ ] §32 Outputs: floor plan, dimension plan, furniture plan, electrical concept, lighting concept, elevation, section, roof plan, site plan — exportable
- [ ] §33 Elevations front/rear/left/right; edit facade, windows, doors, balconies, columns, cladding, colors, lighting, roof
- [ ] §34 AI exterior generator from text updates actual 3D model
- [ ] §46 Cost estimation: Pakistan/UAE/UK/USA/Custom, editable rates, categories, "approximate" label
- [ ] §47 Quantities: flooring, wall, paint, marble, tile, roof areas → material quantities
- [ ] §48 Export PNG JPG PDF SVG DXF OBJ GLTF/GLB; 3D model, floor plan, walkthrough, images, project

## AI
- [ ] §23 NL editing (wider room, move kitchen near dining, add bathroom beside bedroom 3, garage 3 cars, ceiling height, patio larger, add pool, exterior stone, "this marble" on living floor) — modifies the model
- [ ] §44 AI assistant panel with suggestions; understands model; explains what changed / rooms moved / new dims / area changes
- [ ] §53 Structured model is the source of truth, never an AI image
- [ ] §54 Concept images clearly separated from the editable model

## Project, history, UX
- [ ] §37 Projects save plans, 3D, materials, furniture, settings, cameras, designs, versions; continuous autosave
- [ ] §38 Versions: create, restore, duplicate, compare
- [ ] §39 Undo/redo Ctrl+Z / Ctrl+Y for everything
- [ ] §40/§69 Premium UI, dark/light, typography, borders, spacing, animations, icons, tooltips, context menus, shortcuts
- [ ] §41 Layout: menu bar (Project Edit View Export), left toolbar, main canvas, properties strip
- [ ] §42 Modes: PLAN SKETCH 3D MATERIALS INTERIOR EXTERIOR WALKTHROUGH DRONE PRESENTATION — switching is lossless
- [ ] §49 Presentation mode: name, plot, covered area, floors, beds, baths, parking, style; exterior renders, plans, 3D, interiors, materials
- [ ] §51 Errors: what happened / why / possible solution / retry; never crash; autosave before expensive ops
- [ ] §52 Data model with stable IDs
- [ ] §63 First run: Create New House / Open Project / Try Demo House; demo shows plan, 3D, rooms, materials, furniture, garden, garage, walkthrough, drone
- [ ] §64 Shortcuts: Ctrl+Z/Y/S/Shift+S, Del, Ctrl+C/V, R, M, W, D, F, 1, 2, 3, Esc
- [ ] §65 `.homeforge` project file (everything to reopen)
- [ ] §70 Non-expert flow: text → requirements → designs → plan → 3D → rooms → materials → walkthrough
- [ ] §72 Final scenario (1 Kanal … export Floor Plan PDF, 3D images, presentation, 3D model, project file) works end to end
- [ ] §74 Build → run → test → fix, runnable at every milestone
