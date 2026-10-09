# Amendments to the requirements

The 74-section spec in [MASTER_PROMPT.md](MASTER_PROMPT.md) stays in force in full. Nothing in it is removed or weakened. These amendments add to it, or raise a requirement where building the app showed the original wording would leave Pakistani homeowners short. Each amendment lists the sections it extends, what it requires now, and how it is verified.

## A1. Plot location, Qibla and WC orientation

Extends §3 (plot), §6 (constraint engine), §17 (rooms), §32 (drawings), §56 (validation).

- The plot has a city: 14 Pakistani cities, plus Dubai, London and New York. The city sets the sun's latitude (§35) and the Qibla direction.
- The Qibla bearing is the great-circle bearing to the Kaaba. Lahore is 260.4°, Karachi 267.7°, Islamabad 255.9°, London 119.0°.
- Generated and refurnished bathrooms seat the WC side-on to the Qibla wherever a side wall can take it.
- Validation warns when a WC faces the Qibla, or has its back to it, within 45°. The warning says which way the Qibla is and how to fix it.
- The plan view and every drawing sheet show a green Qibla needle inside the north-arrow circle.
- Verified by unit tests: bearings against published values, the facing logic, and at least 90% of generated WCs side-on.

## A2. Rooftop solar planner

Extends §29 (outdoor), §46 (cost), §44 (assistant).

- Panels are real size: 580 W, 2.28 × 1.13 m. They tilt towards the equator at latitude minus 10° (between 10° and 35°).
- Rows are spaced so they do not shade each other at winter-solstice noon.
- Panels go on the open roof, with adjoining terraces merged into one area. They stay 0.45 m off the roof edge and clear of the stair cover and water tank. Planters and outdoor seating make way only when the requested size needs their space.
- Generated houses carry a typical 12-panel system (about 7 kWp).
- In the Cost tab you choose 3, 5, 10 or 15 kW, fill the roof, or remove the panels. It shows kWp, monthly units, yearly saving and payback. Installed cost per kWp and grid price per unit are editable and follow the cost region.
- The assistant understands "add a 5 kW solar system", "fill the roof with solar panels", "remove the solar panels" and "how much solar fits?".
- Yearly yield is estimated by latitude band: about 1,600 units per kWp a year below 28°, 1,450 below 36°. The estimate is marked approximate and says net-metering rules change.
- Verified by unit tests: panels face the equator for every road side, sit inside the open roof, stay clear of obstacles, and payback is plausible. The assistant commands are tested too.

## A3. Grey structure and finishing

Extends §46 (cost estimate).

- Pakistani builders quote a house in two phases, so the estimate does too:
  - grey structure: frame, brickwork, slabs, roof, wiring and pipes;
  - finishing: floors, marble, doors, windows, kitchen, bathrooms, paint, facade, garden.
- The chart and table group lines by phase. The Cost tab shows each phase's total and its rate per ft² beside the overall figures. The assistant's cost answer gives both phases.
- Verified by a unit test: the phases add up to the total.

## A4. Building rules from a development authority

Extends §3 (plot), §6 (constraint engine), §56 (validation).

- The plot can follow the published residential rules of an authority. They come from primary sources:
  - LDA Building and Zoning Regulations 2019, amended to January 2020, approved schemes. §2.2.1 sets the open spaces; §2.2.3 sets ground coverage, storeys, height and FAR.
  - DHA Lahore Construction & Development Regulations 2026. Clause 22 sets clear spaces, clause 23 height (39 ft with stair cover and parapet, 32 ft without; no second floor), and clause 27 first-floor covered area as a share of the ground floor.
- CDA rules are not included because a primary source could not be checked. "No authority rules" keeps the plot's own setbacks.
- Choosing an authority (in the wizard, on the dashboard or in the Issues tab) sets the plot's setbacks. New designs are then generated to comply:
  - The rear space is never reduced below the legal minimum.
  - A design over the coverage limit is regenerated with a deeper back yard.
  - Under DHA, the first floor steps back for an open front terrace, so it stays within the allowed share of the ground floor.
- The Issues tab lists every limit against the design, quoting the document. **Redesign to meet these rules** regenerates within them. Failures also appear as validation warnings.
- Every result says rules change and must be confirmed with the authority.
- Verified by unit tests: the rule values, and generated designs across plot sizes and strategies meeting every LDA and DHA limit with no design errors. 100 combinations were checked while building it.

## A5. Optional Claude vision for sketches and plan photos

Extends §20 and §21, which were previously marked `[~]` because handwriting and dimension text were not read.

- When a Claude API key is set, the plan-image import has a ticked option: "Read room names and sizes with Claude (sends this image to Claude)". The sketch panel has a **Read handwriting with Claude** button.
- Claude returns structured JSON with:
  - room names and their positions on the image (abbreviations such as MBR, D/R and W.C. expanded);
  - dimensions in feet;
  - the overall width, if a dimension line states it.
- The names label the recognised rooms through the existing recogniser. Written sizes such as 16′ × 12′ rescale the plan to the drawing's own dimensions. A written overall width replaces the typed one.
- On a sketch, what Claude read is added as visible labels, so the user can check it and undo it.
- Without a key, offline or in a browser, everything works as before: typed labels and the user entering the overall width.
- The image goes only to Claude, and only when the user chooses it.
- Verified by a unit test: a simulated reading names the rooms and rescales the plan from "16′ × 12′". The live API call needs a key and was not run in this environment.

## A6. Photoreal render

Extends §10 (realistic view), §49 (presentation) and §54 (concept images, previously `[~]` because no image-generation model is bundled).

- **Photoreal render** is available from the 3D pane header, the 3D toolbar and the concept board.
- It path-traces the current 3D view with three-gpu-pathtracer: soft shadows, light bouncing between surfaces, reflections and glass. The sky is the same gradient the live view uses, read into an equirectangular environment. The sun and interior lights come from the scene.
- It renders the real model, so it can never invent a different house.
- Sizes run from 1280 px to 4K, at the live view's aspect ratio. Quality: Preview (32 samples), Good (160) or Best (600). Style: Materials, or Clay (a white model with glass kept). There is a progress bar with time left, and a Stop button.
- The result can be saved as a PNG, or added to the concept board, which feeds the presentation.
- **Graphics backend:**
  - The path tracer returns black surfaces on ANGLE's Direct3D backend, which is the Windows default. This is a known Direct3D problem with rendering into texture-array layers (three.js issue #25353), confirmed here on Direct3D 11 and Direct3D 11-on-12. OpenGL and Vulkan work.
  - Settings now has **Graphics: Automatic / OpenGL / Vulkan**, applied at restart. Automatic keeps Direct3D, so nobody's live view changes unless they choose to.
  - On Direct3D, the render dialog explains this and offers **Switch to OpenGL and restart**. Work is autosaved first.
  - The live 3D view was checked to render the same on OpenGL.
- The library's WebGPU path tracer was also evaluated. With three.js 0.186 it generates invalid WGSL, so the WebGL tracer is used.
- Engine details: the traced copy turns triangles drawn in both windings to agree with their normals, expands instanced trees and plants, and leaves out the sky dome.
- Verified in Chromium on OpenGL (render, save and add to board) and on Direct3D (explanation shown).

## A7. Every bathroom is usable

Raises §5 and §6. The original wording asked for bathrooms; it did not say they must be usable.

- Generation no longer delivers a bathroom without room for a WC, narrower than 3′9″ (1.15 m), or smaller than 1.9 m². A powder room may be 0.9 m wide and 1.2 m².
- In a small bathroom, the WC sits beside the door, clear of the door leaf. A compact wall-hung WC is used if needed.
- If the requested bathrooms cannot all fit at a usable size, the generator first tries other layouts, then one bathroom fewer, so bedrooms share. The design says so, for example "3 bathrooms instead of 4, so each one is big enough to use on this plot".
- Verified by unit tests on 3, 5 and 7 marla across every strategy: every bathroom has a WC, and at most one is flagged.

## A8. Dashboard to the second reference design

Extends the design dashboard (pass 4) to match `docs/reference/dashboard-reference-v2.png`, and raises §5 (designs), §16 (exterior) and §21 (sketch).

- **Five designs, five styles.** With Style set to "Mix of styles", each of the five layouts gets its own architecture: Modern Luxury Villa, Contemporary Design, Classic Elegance, Minimalist Modern and Traditional Style. Each card reads "1 Kanal | 2 Floors | 5 BHK". Choosing one style gives five layouts in that style. The luxury villa loads first, lit at blue hour.
- **Richer exteriors.**
  - A second cladding: for example a stone ground floor with teak feature panels above. It is set in Exterior and drawn in 3D and in the elevations.
  - Entrance pillars, square, round or classical, from the new Pillars requirement.
  - A deeper hip-roof overhang with timber soffits.
  - Larger windows for the luxury style.
  - Organic, smooth-shaded trees, palms and shrubs.
- **Hero editing.**
  - The toolbar has Select, Move, Rotate, Resize, Draw / Sketch, Measure, Undo and Redo, all working on the live 3D view. Click selects a room, wall or piece of furniture. Rotate turns furniture, stairs and columns by 90°. Resize opens the room's dimensions. Move and Measure open the plan with the selection kept.
  - View Mode is Exterior, Interior or Top. Exterior cameras: Drone, Street, Orbit, Front, Back and the sides. Interior cameras list every room.
  - A compass rose shows true north as the camera turns.
  - Lighting: Day, Sunset, Evening and Night. Evening is computed from the actual sunset for the plot's city and date.
- **Tiles and panels.**
  - The 2D and 3D floor plans have zoom in, zoom out and fit.
  - Finishes apply to the floor or the walls of the chosen room. The room preview is rendered in daylight.
  - Room Customization covers flooring, wall finish, ceiling design and furniture style, with thumbnails.
  - Adjust Dimensions has sliders plus exact number boxes.
- **Sketch.**
  - New Rectangle and Circle tools.
  - A small circle, whether drawn with the tool or freehand, becomes a round pillar in the plan.
- Verified:
  - A browser run of 31 dashboard checks: generation, style mix, select, finishes, resize, undo, ceiling, furniture, lighting, picking, rotate, move, measure, the three views, orbit, compass, tile zoom, change material, sketch tools, tours and the menu.
  - The unit tests and the full end-to-end scenario.
- **Everything from the first dashboard is kept alongside the new one:**
  - Projects and light/dark theme buttons in the title bar, next to Settings and the account menu.
  - The Double height requirement.
  - The perspective Front facade camera.
  - Bathrooms and total floor area on each design card.
  - Every library material in a category (Show all), including the user's own uploads.
  - The room choice under the finishes preview.
  - Draw Room and Measure in the plan, from Sketch Tools.
  - Room sizes in feet and inches.
- **Classic Luxury (Marble)** keeps the original luxury look as its own style: Botticino marble cladding, brass window frames, classical columns and a flat roof. It sits next to the new Modern Luxury Villa in the wizard, the Exterior panel, the dashboard style list, the text parser ("classic luxury", "marble villa") and the AI edit commands.
- Fix: dashboard shortcuts into a plan tool (Measure, Draw Room) no longer fall back to Select when switching modes.
- Verified: the dashboard check grows to 42 cases, all passing.

## A9. Home Showcase, AI photos and the PDF brochure

Extends §10 (realistic view), §49 (presentation) and §54 (concept images). §54 was previously limited because no image-generation model was bundled.

- **Home Showcase** opens from the dashboard (the Showcase tab, or the gallery button on the 3D view) and from Export in the workspace. It presents the house as a property brochure:
  - A header with the style ("Modern Luxury Home"), a tagline, BHK, floors and covered area, and the plot size, for example "1 Kanal (500 sq yds)".
  - A hero picture of the front of the house.
  - **Key Features**, worked out from the actual design. These include bedrooms (and whether bathrooms are attached), guest room, kitchens (main and dirty), living areas, dining, basement uses, patio or courtyard, balconies, terraces, parking with the number of cars, lawn and garden area, and pool, prayer room, study, gym, home theatre, double-height lounge, servant quarter, laundry, lift and rooftop solar.
  - **Explore Every Area:** a picture of every area. That is the front, aerial and rear views, entrance, TV lounge, drawing and dining rooms, family lounge, kitchen, every bedroom and bathroom, garage or car porch, balconies and terraces, staircase, basement rooms, and the lawn, patio and pool. Filters group them as Exterior, Living & dining, Kitchen, Bedrooms, Bathrooms, Garage & parking, Terraces & garden, Basement and More rooms. Day or evening light can be set separately for the outside and for the rooms.
- **Camera placement.** Each room is photographed the way a photographer would:
  - The camera stands near the edge of the room, clear of walls, furniture, columns and door swings, and looks across at the furniture.
  - Doors are shut for interior shots.
  - Balconies look outwards, and the garden is seen from above the tree tops.
  - A unit test checks that every interior camera is inside its room and never inside a tall piece of furniture.
- **Large viewer.** Any picture opens full screen, with arrow keys to step through the areas. From there you can:
  - **Look around in 3D**, the live model, starting from the same camera.
  - **Photoreal render**, path-traced as in A6.
  - **Make AI photo.**
  - **Save image.**
  - **Open in 3D editor**, at the same camera.
- **AI photos.** The app's own render of an area goes to an OpenAI GPT Image model as the image to edit, so the result keeps the real layout.
  - **Styles:** *Brochure staging*, the default, dresses rooms like a luxury property brochure: designer furniture of the same size and place, rugs, cushions, art, plants and lamps, and lush planting and lighting outside. Walls, windows, doors, storeys and the main furniture positions are kept. *As designed* changes realism only and adds nothing.
  - **Batch:** "AI photos for all areas" makes them three at a time, after showing how many will be charged. It stops at once on a key or billing error.
  - **Storage:** results are kept with the project. They appear on the area's card, on the concept board, in the presentation and in the brochure.
  - **Settings:** AI photos has the OpenAI key (encrypted on this computer, used only from the main process), the model (GPT Image 2 by default; GPT Image 2.5 Sunburst or Flare, from September 2026, are offered with extra-high quality; GPT Image 1.5 too) and the quality.
  - **Accuracy:** the request uses only the parameters each model accepts. GPT Image 2 always reads input at high fidelity, so `input_fidelity` is sent only to the other models, and extra-high quality only to the 2.5 models. These were taken from the official `openai` SDK's type definitions.
  - **Honesty:** the viewer labels AI photos as impressions made from the model, and says the drawings are what gets built.
- **Save brochure (PDF):** an A4 brochure with the header, hero, key features and every area, three across. It uses AI photos where they exist.
- **Verified:**
  - `e2e/showcase.py`: 18 checks in the browser.
  - `e2e/ai_photo_mock.py`: 14 checks in the real desktop app. It talks to a local stand-in for the OpenAI endpoint, which the SDK reaches through `OPENAI_BASE_URL`. The checks cover the endpoint, key, model, quality, size, the lossless PNG render attached, the prompt, the result shown and kept, and a batch of four.
  - `tests/showcase.test.ts`: 8 unit tests.
- **Not verified here:** no live OpenAI call was made, because that needs the user's key and is charged to their account. The real result depends on OpenAI's model.
- Rendering fix found on the way: the sky's below-horizon colour was olive, which tinted every ceiling green through the environment lighting. It is now a neutral earth tone.

## A10. Performance and rendering quality

Raises §50 (performance). Every change was measured, with `e2e/bench.py` against the production web build (headless Chromium with GPU, 1-kanal house):

| Wait | Before | After |
|---|---|---|
| Main thread blocked while the app starts | ~12 s | ~3 s |
| Dashboard pictures complete (cut-away, finishes preview, video tile) | 13.6 s | 6.6 s |
| Five design cards after generating | 10.1 s | 3.5 s |
| Home Showcase, all 25 pictures | 4.6 s | 2.3 s |
| Relighting the rooms in the showcase | 7.4 s | 1.1 s |
| Opening an area: first picture | 0.4 s | 0.08 s (full detail follows in ~3 s) |

What changed, and why:
- **Shaders compile in the background** (`KHR_parallel_shader_compile`), and drawing waits for them. A CPU profile showed 9.5 s of the 12 s start-up stall was shader compilation on the main thread. Three causes were removed:
  - Each textured material compiled twice. It now has neutral 1×1 texture slots from the start, and real textures swap in.
  - Each change in the number of night lights recompiled every shader. A fixed pool of lights is now reused.
  - Screen and post-processing shaders are different programs, so drawing on both paths compiled two sets. Every frame now goes through post-processing when quality has it, with 4× multisampling, which also smooths edges at night.
  - The readiness check asks the GPU about one unfinished program at a time, instead of all of them every 10 ms.
- **Textures arrive progressively.** Every material gets a 256 px texture within about a second, so pictures are never taken half-textured. Full-size textures follow on at most a third of the workers, so design generation keeps its cores. Close-up pictures, exports and Photoreal wait for full size.
- **Texture workers:**
  - Up to 6 workers instead of 3, fed from one queue: view textures first, then swatches, then full-size upgrades.
  - Identical requests share one job.
- **The picture queue:**
  - A picture nobody wants any more (an effect re-run, a filter change, leaving the page) is skipped.
  - No fixed 60 ms sleep per picture.
  - The previous view is restored only when one is on screen.
  - The queue moves on while the image encodes.
- **Built floors and sites are kept** (the last 40) and reused when the same state returns, such as the house on screen after a design card's picture, or doors shut and open again.
- **The desktop renderer bundle is minified:** 4.2 MB down to 2.2 MB to parse at every start.
- **Pictures are rendered at 1.5–2× and scaled down**, so walls, railings and furniture have clean edges.

Bugs found while measuring:
- After a quality change, the house was drawn twice. The old builds stayed in the scene.
- At night, the studio environment's bright panels showed as white blobs in glossy floors and glass. Nights now use a soft, even surround.
- Room downlights were dropped in large houses, so night rooms were lit only by the environment. The light budget alone now caps them.
- From inside, garden lights shone through walls and window glass glowed like a floodlight. Both now apply only outside.
