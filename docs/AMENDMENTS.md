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

- When a Claude API key is set, a sketch or plan photo can be sent to Claude to read the hand-written room names and dimension text. The answer is structured JSON: room labels with their positions, and the dimensions with their values.
- The app then names the recognised rooms and sets the scale from a written dimension.
- Without a key, or offline, everything works as before: typed labels and the user entering the overall width.

## A6. Photoreal render

Extends §10 (realistic view), §49 (presentation) and §54 (concept images, previously `[~]` because no image-generation model is bundled).

- A path-traced still of the current 3D view gives soft shadows, light bouncing between surfaces and true reflections.
- It renders the real model, so it never invents a different house. It can be saved as an image or added to the concept board and the presentation.

## A7. Every bathroom is usable

Raises §5 and §6. The original wording asked for bathrooms; it did not say they must be usable.

- Generation no longer delivers a bathroom without room for a WC, narrower than 3′9″ (1.15 m), or smaller than 1.9 m². A powder room may be 0.9 m wide and 1.2 m².
- In a small bathroom, the WC sits beside the door, clear of the door leaf. A compact wall-hung WC is used if needed.
- If the requested bathrooms cannot all fit at a usable size, the generator first tries other layouts, then one bathroom fewer, so bedrooms share. The design says so, for example "3 bathrooms instead of 4, so each one is big enough to use on this plot".
- Verified by unit tests on 3, 5 and 7 marla across every strategy: every bathroom has a WC, and at most one is flagged.
