https://github.com/ALiAdnan3/MLOPs_Ass_1.git

# MASTER PROMPT — BUILD AN AI HOME ARCHITECT & 3D HOUSE DESIGNER DESKTOP APPLICATION

You are an expert software architect, UI/UX designer, 3D application developer, CAD developer, procedural-generation engineer, and AI product engineer.

I want you to build a **professional desktop application for designing, generating, editing, visualizing, and exploring residential houses in 2D and 3D**.

The application should feel like a simplified combination of:

* AutoCAD
* SketchUp
* Floorplanner
* Revit
* HomeByMe
* Sweet Home 3D
* AI architectural design tools

But it should be significantly easier for an ordinary person to use.

The goal is:

> A user should be able to enter the size and requirements of their house, generate multiple possible architectural designs, select one, see its complete 2D floor plan and realistic 3D version, modify anything interactively, upload their own marble/stone/tile/wood/wall images and apply them to surfaces, and finally explore the completed house through realistic interior, exterior, walkthrough, and drone-style views.

Build this as a **real working desktop application**, not a static mockup.

---

# 1. CORE PRODUCT

The application should be called:

**HomeForge AI**

Subtitle:

**Design. Generate. Customize. Experience Your Home.**

The application should support the complete workflow:

```text
House Requirements
        ↓
Plot / House Size
        ↓
AI / Procedural Design Generation
        ↓
Multiple Floor Plans
        ↓
Select Design
        ↓
2D Architectural Plan
        ↓
3D Conversion
        ↓
Interior + Exterior
        ↓
Customize Everything
        ↓
Upload Materials
        ↓
Apply Marble / Stone / Wood / Tiles
        ↓
Lighting + Furniture
        ↓
3D Walkthrough
        ↓
Drone / Exterior View
        ↓
Save / Export
```

Everything must remain editable after generation.

---

# 2. DESKTOP APPLICATION

Build this as a proper desktop application.

The application should work well on a normal Windows laptop.

Prioritize:

* Performance
* Low RAM usage
* Fast startup
* Smooth 2D editing
* Smooth 3D navigation
* Autosave
* Offline-first functionality where possible
* Local project storage
* No unnecessary cloud dependency

The application should not require an expensive dedicated GPU for basic functionality.

For advanced rendering, provide scalable quality settings:

```text
Low
Medium
High
Ultra
```

---

# 3. HOUSE SIZE SYSTEM

The user must be able to specify the property size.

Support common Pakistani plot sizes as presets:

* 3 Marla
* 5 Marla
* 7 Marla
* 8 Marla
* 10 Marla
* 12 Marla
* 15 Marla
* 1 Kanal
* 2 Kanal
* 4 Kanal

Also provide:

### Custom Plot

Allow the user to manually enter:

```text
Plot Length
Plot Width
Unit
```

Support:

* Feet
* Inches
* Meters
* Centimeters

Allow irregular plots in advanced mode.

Example:

```text
Width: 35 ft
Length: 70 ft
```

The application should automatically calculate the approximate plot area.

---

# 4. HOUSE REQUIREMENT WIZARD

Create a beautiful step-by-step wizard.

The user should not need architectural knowledge.

Step 1:

## Plot

```text
Plot Size
Plot Width
Plot Length
Road Direction
North Direction
Corner Plot?
```

Step 2:

## Floors

Options:

```text
Single Story
Double Story
Triple Story
Basement + Ground
Basement + Ground + First
Basement + Ground + First + Second
Custom
```

Step 3:

## Rooms

Allow the user to specify:

```text
Bedrooms
Master Bedrooms
Guest Bedroom
Bathrooms
Powder Rooms
Kitchen
Dirty Kitchen
Dining Room
TV Lounge
Drawing Room
Living Room
Family Room
Study Room
Office
Kids Room
Prayer Room
Laundry
Store
Pantry
Servant Room
Servant Bathroom
Walk-in Closet
Dressing Room
```

Step 4:

## Outdoor Requirements

```text
Garage
Number of Cars
Front Lawn
Back Lawn
Courtyard
Patio
Terrace
Balcony
Swimming Pool
Outdoor Kitchen
Outdoor Sitting
Garden
Play Area
BBQ Area
```

Step 5:

## Special Requirements

```text
Basement
Double Height Lounge
Double Height Entrance
Central Courtyard
Large Windows
Skylight
Atrium
Staircase Type
Elevator
Home Theater
Gym
Game Room
Library
Office
Rooftop Garden
```

Step 6:

## Architectural Style

Allow:

```text
Modern
Contemporary
Minimalist
Traditional
Luxury
Islamic
Mediterranean
European
Colonial
Industrial
Farmhouse
Pakistani Modern
Custom
```

Step 7:

## Preferences

Allow sliders for:

```text
Privacy
Natural Light
Ventilation
Open Space
Luxury
Green Space
Parking
Entertainment
Family Space
```

---

# 5. AI HOUSE DESIGN GENERATOR

This is one of the most important features.

After the user enters requirements, generate multiple possible designs.

Example:

```text
Generate Designs

Requirements:
10 Marla
Double Story
4 Bedrooms
1 Guest Room
2 Car Garage
Basement
Patio
Lawn
2 Kitchens
Drawing Room
TV Lounge
Study
3 Bathrooms
Modern Style
High Privacy
Large Windows
```

Generate several alternatives:

```text
Design A — Modern Family Layout
Design B — Luxury Open Layout
Design C — Privacy Focused Layout
Design D — Maximum Garden Layout
Design E — Maximum Room Space Layout
```

Do NOT generate only images.

Generate actual structured architectural layouts.

Each design must contain:

* Plot boundary
* Walls
* Rooms
* Doors
* Windows
* Stairs
* Columns
* Parking
* Garden
* Patio
* Bathrooms
* Kitchen
* Furniture placeholders
* Dimensions
* Floor information

The design must be editable.

---

# 6. ARCHITECTURAL CONSTRAINT ENGINE

The application must understand basic architectural constraints.

Do not randomly place rooms.

Consider:

### Structural

* Wall thickness
* Columns
* Beams
* Staircase space
* Floor heights
* Door sizes
* Window sizes

### Functional

* Bedroom accessibility
* Bathroom accessibility
* Kitchen connectivity
* Dining proximity
* Garage access
* Stair access
* Corridor widths

### Environmental

* Natural light
* Ventilation
* Window placement
* Courtyard
* Outdoor spaces

### Privacy

For example:

```text
Public:
Entrance
Drawing Room
Guest Room

Semi-private:
Dining
TV Lounge
Kitchen

Private:
Bedrooms
Bathrooms
Family Lounge
```

The generator should attempt to logically separate these zones.

---

# 7. 2D FLOOR PLAN EDITOR

Create a professional but beginner-friendly 2D editor.

The interface should resemble a simplified architectural/CAD application.

Left toolbar:

```text
Select
Wall
Room
Door
Window
Column
Stair
Dimension
Text
Furniture
Garden
Pool
Garage
Patio
```

The user can:

* Draw walls
* Move walls
* Resize rooms
* Add rooms
* Delete rooms
* Split rooms
* Merge rooms
* Move doors
* Move windows
* Resize doors
* Resize windows
* Add columns
* Add stairs
* Add furniture
* Add dimensions

Everything should snap intelligently.

Support:

```text
Grid snapping
Wall snapping
Object snapping
Alignment guides
Dimension snapping
```

---

# 8. PARAMETRIC DESIGN

This is extremely important.

The design must be **parametric**.

If the user changes:

```text
Bedroom width
```

the room should resize.

If the user changes:

```text
House width
```

the design should intelligently adjust.

If the user changes:

```text
Floor height
```

the 3D model should update.

If the user changes:

```text
Number of bedrooms
```

the system should be able to regenerate/rearrange the plan.

Do not create a collection of disconnected images.

Create an actual structured house model.

---

# 9. 3D HOUSE GENERATION

Every 2D design should have a:

**"Generate 3D"**

button.

Convert:

```text
2D Walls
+
Doors
+
Windows
+
Rooms
+
Floors
+
Roof
+
Stairs
+
Columns
```

into a 3D architectural model.

The user should be able to:

* Rotate
* Pan
* Zoom
* Walk
* Enter rooms
* Change camera height
* Look around
* View from above
* View from street
* View from inside

---

# 10. 3D VIEW MODES

Provide:

### Architectural View

Clean 3D model.

### Realistic View

Materials + lighting + shadows.

### Day View

Natural sunlight.

### Evening View

Warm exterior lighting.

### Night View

Interior/exterior lighting.

### Dollhouse View

Cutaway house showing rooms.

### Floor View

Show individual floors separately.

### Exploded View

Allow floors/sections to separate vertically.

---

# 11. DRONE / CINEMATIC MODE

Add:

**"Drone View"**

The application should automatically create a cinematic camera route around the house.

Example:

```text
Start above front gate
↓
Move toward house
↓
Rotate around front facade
↓
Move above roof
↓
Show complete plot
↓
Move toward backyard
↓
Enter through main entrance
↓
Show living room
↓
Move toward dining
↓
Show kitchen
↓
Move upstairs
↓
Show bedrooms
```

Allow:

```text
Play
Pause
Restart
Speed
Camera height
Camera path
```

Also allow export of the walkthrough as a video if technically practical.

---

# 12. INTERIOR WALKTHROUGH

Add:

**Walk Inside**

The user can navigate through the house.

Controls:

```text
W
A
S
D
Mouse
```

Optional:

```text
Arrow keys
Gamepad
```

Provide collision detection so the camera cannot walk through walls.

---

# 13. MATERIAL UPLOAD SYSTEM

One of the most important features.

Allow the user to upload images of:

* Marble
* Granite
* Stone
* Tiles
* Wood
* Wallpaper
* Paint
* Brick
* Flooring
* Ceiling material
* Kitchen material
* Countertop
* Exterior cladding

Example:

User uploads:

```text
my_marble.jpg
```

Then selects:

```text
Floor
```

The application should show:

> Apply this material to selected surface?

YES / CANCEL

Then automatically map the uploaded image onto the selected surface.

---

# 14. AI MATERIAL PROCESSING

When the user uploads a material image, analyze it.

Automatically estimate:

```text
Texture type
Tile pattern
Color
Roughness
Reflectivity
Scale
```

Generate usable PBR-style material maps where possible:

```text
Base Color
Roughness
Normal
Height
Metallic
```

Allow manual adjustments:

```text
Texture Scale
Rotation
Offset
Roughness
Reflection
Brightness
Contrast
```

---

# 15. REALISTIC MATERIAL PREVIEW

When the user selects a room:

```text
Bedroom
```

and uploads marble, show:

### Before

Original room.

### After

Room with uploaded marble.

Provide a comparison slider:

```text
Before | After
```

Do this for:

* Floors
* Walls
* Countertops
* Exterior walls
* Stairs
* Bathrooms
* Kitchens
* Columns

---

# 16. MATERIAL LIBRARY

Include a built-in material library.

Categories:

```text
Marble
Granite
Ceramic
Porcelain
Wood
Concrete
Brick
Stone
Paint
Metal
Glass
Roof
Wallpaper
```

Allow users to save custom materials.

```text
My Materials
```

---

# 17. ROOM DESIGNER

The user should be able to select any room and customize it separately.

Example:

```text
Bedroom
```

Panel:

```text
Room Size
Wall Material
Floor Material
Ceiling
Doors
Windows
Lighting
Furniture
Color
Curtains
Bed
Wardrobe
TV
Decorations
```

Same system for:

```text
Kitchen
Bathroom
TV Lounge
Dining
Drawing Room
Garage
Patio
Garden
Basement
```

---

# 18. FURNITURE SYSTEM

Provide furniture categories:

```text
Beds
Sofas
Dining Tables
Chairs
Tables
TV Units
Wardrobes
Cabinets
Kitchen Units
Bathtubs
Showers
Toilets
Sinks
Desks
Bookshelves
Outdoor Furniture
```

Allow:

* Move
* Rotate
* Resize
* Duplicate
* Delete

---

# 19. SKETCH MODE

Add a feature called:

**Sketch Mode**

The user can draw the house manually.

For example:

```text
User draws:

+-----------------------+
| Bedroom | Bedroom     |
|         |             |
|---------+-------------|
| Lounge                |
|                       |
|-------------+---------|
| Kitchen     | Dining  |
+-------------+---------+
```

The application should recognize the sketch.

Convert it into:

```text
Clean 2D Floor Plan
```

Then:

```text
Generate 3D
```

and automatically create the corresponding 3D house.

---

# 20. HAND-DRAWN SKETCH RECOGNITION

Allow:

### Mouse drawing

### Drawing tablet

### Touchscreen

### Imported sketch image

The recognition system should detect:

* Walls
* Rooms
* Doors
* Windows
* Labels
* Dimensions

If confidence is low, ask the user:

> "Did you mean this to be a bedroom?"

---

# 21. IMAGE → FLOOR PLAN

Allow the user to upload an existing floor-plan image.

Example:

```text
floorplan.png
```

The system attempts to convert it into editable geometry.

Process:

```text
Image
↓
Detect walls
↓
Detect rooms
↓
Detect doors
↓
Detect windows
↓
Detect dimensions
↓
Create editable floor plan
↓
Generate 3D
```

---

# 22. AI TEXT → HOUSE DESIGN

Allow the user to simply type:

> "Design a modern 10 marla double-storey house with 4 bedrooms, 2 car parking, basement, large lawn, patio, dirty kitchen, drawing room and a double-height entrance."

The application should convert this into structured requirements.

Then generate designs.

---

# 23. NATURAL LANGUAGE EDITING

After generating a design, allow commands such as:

> "Make the master bedroom 2 feet wider."

> "Move the kitchen closer to the dining room."

> "Add a bathroom beside bedroom 3."

> "Make the garage large enough for 3 cars."

> "Increase the ceiling height."

> "Make the patio larger."

> "Add a swimming pool."

> "Change the exterior to stone."

> "Use this marble on the living room floor."

The application should modify the actual model rather than simply generating another image.

---

# 24. DESIGN VARIATIONS

Provide:

**Generate Alternatives**

For an existing house, generate variations such as:

```text
More garden
More bedrooms
More parking
More privacy
More natural light
More luxury
More open space
More modern
More traditional
```

Show alternatives side by side.

---

# 25. FLOOR MANAGEMENT

Support:

```text
Basement
Ground Floor
First Floor
Second Floor
Roof
```

Provide a floor selector:

```text
BASEMENT
GROUND
FIRST
SECOND
ROOF
3D ALL
```

Users can hide/show floors.

---

# 26. BASEMENT DESIGN

Basement should be a first-class feature.

Support:

```text
Basement lounge
Home theater
Gym
Game room
Storage
Bedroom
Bathroom
Office
Wine/storage area
Laundry
Mechanical room
Stair access
Light well
```

Provide realistic basement lighting.

---

# 27. STAIRS

Support different staircase types:

```text
Straight
L-shaped
U-shaped
Spiral
Floating
Modern
Traditional
```

Allow:

```text
Width
Height
Number of steps
Material
Railing
```

---

# 28. GARAGE

Garage designer:

```text
1 Car
2 Cars
3 Cars
4 Cars
```

Allow:

```text
Garage door
Car positioning
Storage
Workshop
EV charger
```

---

# 29. GARDEN / LAWN / PATIO

Allow users to design outdoor areas.

Objects:

```text
Grass
Trees
Plants
Flowers
Walkways
Patio
Pergola
Outdoor seating
Pool
Water feature
BBQ
Boundary wall
Gate
```

---

# 30. ARCHITECTURAL DIMENSIONS

Every important object should have dimensions.

Example:

```text
Bedroom

Width: 14 ft
Length: 16 ft
Height: 11 ft
Area: 224 sq ft
```

For walls:

```text
Length
Thickness
Height
```

For doors:

```text
Width
Height
```

For windows:

```text
Width
Height
Sill height
```

---

# 31. MEASUREMENT TOOLS

Provide:

```text
Measure distance
Measure room area
Measure wall length
Measure ceiling height
Measure total floor area
Measure plot area
```

Automatically calculate:

```text
Covered Area
Open Area
Floor Area
Room Area
Garage Area
Garden Area
```

---

# 32. PROFESSIONAL DRAWING OUTPUT

Allow users to generate:

```text
Floor Plan
Dimension Plan
Furniture Plan
Electrical Concept Plan
Lighting Concept
Elevation
Section
Roof Plan
Site Plan
```

These should be exportable.

---

# 33. HOUSE ELEVATIONS

Generate exterior elevations:

```text
Front Elevation
Rear Elevation
Left Elevation
Right Elevation
```

Allow editing of:

```text
Facade
Windows
Doors
Balconies
Columns
Cladding
Colors
Lighting
Roof
```

---

# 34. AI EXTERIOR GENERATOR

Allow:

> "Make the front elevation more modern with large glass windows, stone cladding and vertical lighting."

The actual 3D model should be updated where possible.

Do not make the application dependent on AI-generated images for the core model.

---

# 35. REALISTIC LIGHTING

Support:

```text
Sun direction
Time of day
Latitude
Season
Artificial lights
Interior lights
Exterior lights
```

Presets:

```text
Morning
Noon
Afternoon
Sunset
Night
```

---

# 36. CAMERA SYSTEM

Provide cameras:

```text
Top
Front
Back
Left
Right
Street
Interior
Room
Drone
Orbit
First Person
```

Allow camera bookmarks.

---

# 37. PROJECT SYSTEM

Users should be able to create projects.

Example:

```text
My Dream House
```

Save:

```text
Project
Floor plans
3D model
Materials
Furniture
Settings
Camera positions
Generated designs
Versions
```

Autosave continuously.

---

# 38. VERSION HISTORY

Every major change should optionally create a version.

Example:

```text
Version 1
Original Design

Version 2
Added Basement

Version 3
Expanded Master Bedroom

Version 4
Changed Marble

Version 5
Added Pool
```

Allow:

```text
Restore
Duplicate
Compare
```

---

# 39. UNDO / REDO

Provide a strong undo/redo system.

```text
Ctrl + Z
Ctrl + Y
```

It should work for:

* Room resizing
* Wall movement
* Materials
* Furniture
* Structural changes
* 3D modifications

---

# 40. UI DESIGN

The interface must look like a premium professional desktop application.

Avoid generic/basic web-dashboard styling.

Design inspiration:

* Linear
* Figma
* SketchUp
* AutoCAD
* Blender
* Apple
* Vercel
* Notion

But do NOT copy any one application's UI.

Use:

* Clean dark/light themes
* Professional typography
* Subtle borders
* Excellent spacing
* Smooth animations
* Clear icons
* Tooltips
* Context menus
* Keyboard shortcuts

---

# 41. MAIN APPLICATION LAYOUT

Suggested layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ HomeForge AI       Project     Edit     View     Export      │
├──────────────┬───────────────────────────────────────────────┤
│              │                                               │
│ TOOLBAR      │                                               │
│              │              MAIN CANVAS                      │
│ Select       │                                               │
│ Wall         │          2D / 3D / Sketch                    │
│ Room         │                                               │
│ Door         │                                               │
│ Window       │                                               │
│ Furniture    │                                               │
│ Materials    │                                               │
│              │                                               │
├──────────────┴───────────────────────────────────────────────┤
│ Properties / Dimensions / Object Controls                    │
└──────────────────────────────────────────────────────────────┘
```

---

# 42. MODES

The application should have clear modes:

```text
PLAN
SKETCH
3D
MATERIALS
INTERIOR
EXTERIOR
WALKTHROUGH
DRONE
PRESENTATION
```

Switching modes should not destroy anything.

---

# 43. OBJECT SELECTION

When the user clicks an object:

Example:

```text
Master Bedroom
```

show:

```text
Dimensions
Area
Floor
Wall Material
Floor Material
Ceiling
Windows
Doors
Furniture
Lighting
```

Allow direct editing.

---

# 44. AI DESIGN ASSISTANT

Include an AI assistant panel.

Example:

```text
┌────────────────────────────┐
│ HomeForge AI               │
│                            │
│ "What would you like?"     │
│                            │
│ [Make bedroom larger]      │
│ [Add basement]             │
│ [Improve layout]           │
│ [Add parking]              │
│                            │
└────────────────────────────┘
```

The AI should understand the current house model and project.

It should be able to explain:

* What changed
* Which rooms moved
* New dimensions
* Area changes

---

# 45. DESIGN EXPLANATION

When AI generates a design, show:

```text
Why this design?

• Bedrooms placed in private zone
• Kitchen connected to dining
• Garage near entrance
• Patio connected to lounge
• Large windows positioned for natural light
• Basement access located near staircase
```

---

# 46. COST ESTIMATION

Add an optional cost estimation system.

Allow region:

```text
Pakistan
UAE
UK
USA
Custom
```

For Pakistan, allow user-defined/local rates.

Estimate:

```text
Construction area
Approximate structure cost
Flooring
Marble
Doors
Windows
Kitchen
Bathrooms
Electrical
Plumbing
Paint
Exterior
Landscaping
```

Clearly label estimates as approximate.

Allow users to modify unit rates.

---

# 47. MATERIAL QUANTITY ESTIMATION

If possible, calculate:

```text
Flooring Area
Wall Area
Paint Area
Marble Area
Tile Area
Roof Area
```

Then estimate required material quantity.

---

# 48. EXPORT

Support:

```text
PNG
JPG
PDF
SVG
DXF
OBJ
GLTF / GLB
```

Where technically practical.

Also allow:

### Export 3D Model

### Export Floor Plan

### Export Walkthrough

### Export Images

### Export Project

---

# 49. PRESENTATION MODE

Create a beautiful presentation mode.

Show:

```text
House Name
Plot Size
Covered Area
Floors
Bedrooms
Bathrooms
Parking
Design Style
```

Then display:

```text
Exterior render
Floor plans
3D views
Interior views
Materials
```

---

# 50. RESPONSIVE PERFORMANCE

The application must remain usable for reasonably complex houses.

Use:

* Efficient scene graph
* Object instancing
* Level of detail
* Lazy loading
* Texture compression
* Cached geometry
* GPU acceleration where available
* Efficient undo history
* Background processing for expensive operations

Avoid unnecessary rerendering.

---

# 51. ERROR HANDLING

The application must never silently break.

If something cannot be generated:

Show:

```text
What happened
Why
Possible solution
Retry
```

Do not crash the application.

Autosave before expensive operations.

---

# 52. DATA MODEL

Create a structured house model.

Example conceptual structure:

```text
Project
 ├── Plot
 ├── Floors
 │    ├── Floor
 │    │    ├── Rooms
 │    │    ├── Walls
 │    │    ├── Doors
 │    │    ├── Windows
 │    │    ├── Columns
 │    │    ├── Stairs
 │    │    ├── Furniture
 │    │    └── Materials
 │
 ├── Exterior
 ├── Garden
 ├── Garage
 ├── Materials
 ├── Cameras
 ├── Versions
 └── Settings
```

Use stable IDs for all objects so modifications remain reliable.

---

# 53. IMPORTANT ARCHITECTURAL RULE

Do NOT make the generated house merely an AI image.

The application must have an actual structured representation of:

```text
Walls
Rooms
Doors
Windows
Floors
Stairs
Furniture
Materials
Objects
```

An AI image can be used for visualization, but the editable architectural model is the source of truth.

---

# 54. AI IMAGE GENERATION

AI image generation may be used for:

* Exterior concept visualization
* Interior concept visualization
* Style exploration
* Material preview
* Inspiration

But clearly separate:

```text
Concept Image
```

from:

```text
Editable 3D Model
```

---

# 55. DESIGN GENERATION PIPELINE

Implement this conceptual pipeline:

```text
USER REQUIREMENTS
       ↓
STRUCTURED REQUIREMENTS
       ↓
CONSTRAINT ENGINE
       ↓
SPACE ALLOCATION
       ↓
ROOM GRAPH
       ↓
FLOOR PLAN GENERATION
       ↓
VALIDATION
       ↓
3D GEOMETRY
       ↓
MATERIALS
       ↓
LIGHTING
       ↓
CAMERA
       ↓
RENDER
```

---

# 56. DESIGN VALIDATION

Before accepting a generated design, check for:

```text
Overlapping rooms
Invalid walls
Disconnected rooms
Doors blocked by walls
Impossible stairs
Rooms without access
Invalid dimensions
Furniture outside rooms
Windows inside walls incorrectly
Garage inaccessible
Basement disconnected
```

Show warnings rather than silently accepting invalid geometry.

---

# 57. BEGINNER MODE

Provide two modes:

## Beginner

Simple interface.

```text
Draw Room
Move Room
Resize
Add Door
Add Window
Materials
3D
```

## Advanced

Expose:

```text
Exact dimensions
Coordinates
Wall thickness
Floor height
Structural objects
Layers
Advanced snapping
Object properties
```

---

# 58. PROFESSIONAL LAYERS

Support:

```text
Architecture
Structure
Furniture
Electrical
Plumbing
Landscape
Lighting
Materials
Annotations
```

Users can hide/show layers.

---

# 59. GRID AND UNITS

Allow grid:

```text
1 inch
3 inches
6 inches
1 foot
Custom
```

Snap automatically.

---

# 60. SMART ROOM LABELING

Automatically identify rooms:

```text
MASTER BEDROOM
BEDROOM 2
KITCHEN
DINING
TV LOUNGE
BATHROOM
GARAGE
PATIO
```

Allow renaming.

---

# 61. DESIGN COMPARISON

Allow two generated designs to be compared.

Example:

```text
Design A                 Design B

Bedrooms: 4             Bedrooms: 4
Bathrooms: 4            Bathrooms: 4
Parking: 2              Parking: 3
Garden: 420 sq ft       Garden: 300 sq ft
Covered: 2,800 sq ft    Covered: 3,000 sq ft
```

And show their 2D/3D views side by side.

---

# 62. HOME DESIGN TEMPLATES

Include starter templates:

```text
5 Marla Modern
5 Marla Double Story
10 Marla Modern
10 Marla Luxury
10 Marla Basement
15 Marla Luxury
1 Kanal Modern
1 Kanal Luxury
2 Kanal Estate
4 Kanal Estate
```

These are starting templates and remain completely editable.

---

# 63. DEMO EXPERIENCE

When the application starts for the first time, provide:

```text
Create New House
Open Project
Try Demo House
```

The demo house should demonstrate:

* 2D floor plan
* 3D model
* Multiple rooms
* Materials
* Furniture
* Garden
* Garage
* Walkthrough
* Drone mode

---

# 64. KEYBOARD SHORTCUTS

Implement useful shortcuts:

```text
Ctrl + Z       Undo
Ctrl + Y       Redo
Ctrl + S       Save
Ctrl + Shift + S   Save As
Delete         Delete
Ctrl + C       Copy
Ctrl + V       Paste
R              Rotate
M              Move
W              Wall
D              Dimension
F              Fit View
1              2D
2              3D
3              Walkthrough
Esc            Cancel
```

---

# 65. PROJECT FILE

Create a native project format:

```text
.homeforge
```

The project should contain everything needed to reopen the house.

Example:

```text
my_house.homeforge
```

The user should be able to save and reopen projects without losing:

* Floor plans
* 3D model
* Materials
* Furniture
* AI designs
* Camera positions
* Versions

---

# 66. TECHNICAL ARCHITECTURE

Choose technologies that are practical for a desktop application and 3D visualization.

Prefer a modern architecture such as:

```text
Desktop Shell
+
Modern UI
+
2D Canvas
+
3D Engine
+
Local Database
+
Procedural Geometry Engine
+
AI Integration Layer
```

Choose the actual technologies based on stability, performance, ease of development, and long-term maintainability.

Do not introduce unnecessary technologies.

Keep the architecture modular.

Suggested modules:

```text
core/
    project
    geometry
    units
    constraints

planner/
    room-generator
    floor-plan
    validation

editor/
    2d-editor
    sketch-editor
    property-panel

engine/
    3d-scene
    materials
    lighting
    cameras

ai/
    requirement-parser
    design-generator
    image-analysis
    natural-language-editor

render/
    realtime
    high-quality
    walkthrough

export/
    pdf
    image
    3d

storage/
    project
    autosave
    versions
```

---

# 67. DEVELOPMENT STRATEGY

Do NOT attempt to build every advanced feature simultaneously.

Build in phases.

## PHASE 1 — FOUNDATION

Implement:

* Desktop application
* Main UI
* Project creation
* Plot dimensions
* Units
* 2D grid
* Basic wall drawing
* Rooms
* Doors
* Windows
* Save/load

## PHASE 2 — 2D ARCHITECTURAL ENGINE

Implement:

* Parametric walls
* Room resizing
* Dimensions
* Snapping
* Floor management
* Stairs
* Columns
* Garage
* Garden
* Patio

## PHASE 3 — 3D ENGINE

Implement:

* Wall extrusion
* Floors
* Doors
* Windows
* Stairs
* Roof
* Camera
* Lighting
* 3D navigation

## PHASE 4 — MATERIALS

Implement:

* Material library
* Image upload
* Texture mapping
* Marble
* Stone
* Wood
* Tiles
* PBR parameters

## PHASE 5 — AI DESIGN GENERATION

Implement:

* Requirement parser
* Room allocation
* Multiple design generation
* Design validation
* AI assistant

## PHASE 6 — SKETCH

Implement:

* Freehand drawing
* Sketch recognition
* Image → floor plan
* Floor plan → 3D

## PHASE 7 — WALKTHROUGH

Implement:

* First-person navigation
* Collision
* Interior camera
* Drone camera
* Cinematic paths

## PHASE 8 — EXPORT

Implement:

* PDF
* Images
* 3D formats
* Project files
* Video where practical

## PHASE 9 — POLISH

Implement:

* Animations
* Performance optimization
* Error handling
* Autosave
* Version history
* Professional UI
* Onboarding
* Documentation

---

# 68. DEVELOPMENT RULE

Do not create fake functionality.

For example, do not create a button:

```text
Generate 3D
```

that only changes the UI or displays a placeholder image.

The feature should actually generate geometry.

Similarly:

```text
Apply Material
```

must actually modify the selected 3D surface.

```text
Resize Room
```

must actually change the underlying geometry.

```text
Generate Design
```

must create a real structured floor plan.

---

# 69. UI QUALITY

The final application should look like a commercial product.

Avoid:

* Default browser-looking UI
* Huge unnecessary cards
* Excessive gradients
* Cheap-looking icons
* Random colors
* Excessive rounded corners
* Cluttered panels

Use a professional architectural/engineering aesthetic.

Make the 3D viewport the visual centerpiece.

---

# 70. USER EXPERIENCE

The entire experience should feel like:

> "I don't need to know architecture. I describe what I want, and HomeForge AI helps me build it."

A normal user should be able to go from:

```text
"I want a 10 marla double-storey house"
```

to:

```text
Requirements
→
Generated designs
→
Selected design
→
2D plan
→
3D house
→
Customized rooms
→
Materials
→
Walkthrough
```

without needing CAD expertise.

---

# 71. IMPORTANT SAFETY / PROFESSIONAL DISCLAIMER

The application is a design and visualization tool.

It must clearly state that generated designs are:

```text
Conceptual / preliminary designs
```

and should be reviewed by qualified architects/engineers before construction.

Do not claim that the generated design is automatically structurally safe or legally approved.

---

# 72. FINAL PRODUCT EXPERIENCE

The final application should allow this exact scenario:

A user opens HomeForge AI.

They select:

```text
1 Kanal
```

Then:

```text
Double Story
Basement
5 Bedrooms
2 Guest Rooms
3 Car Garage
Large Lawn
Patio
Swimming Pool
Drawing Room
Dining Room
TV Lounge
2 Kitchens
Study
Prayer Room
Modern Luxury
Large Windows
High Privacy
```

They click:

**GENERATE DESIGNS**

The application generates several complete architectural concepts.

The user selects one.

The application displays:

```text
2D FLOOR PLAN
```

and:

```text
3D HOUSE
```

The user clicks:

**EDIT**

They enlarge the master bedroom.

The system updates the room and surrounding geometry.

They select the living-room floor.

They upload:

```text
white_marble.jpg
```

The system analyzes the image and applies it to the floor.

The user changes:

```text
Floor → Marble
Wall → Paint
TV Wall → Stone
Stairs → Wood
```

The user switches to:

**3D**

They can walk inside the house.

Then they click:

**DRONE VIEW**

and see a cinematic exterior camera movement around the house.

They switch to:

**SKETCH MODE**

and draw an additional room.

The system converts the sketch into a proper room.

They click:

**GENERATE 3D**

and the new room appears in the 3D model.

Finally they click:

**EXPORT**

and receive:

```text
Floor Plan PDF
3D Images
House Presentation
3D Model
Project File
```

---

# 73. MOST IMPORTANT REQUIREMENT

Think of this application as a combination of:

**AI Architect + CAD Floor Planner + 3D Home Designer + Material Visualizer + Virtual Walkthrough**

The application must maintain a single source of truth:

```text
STRUCTURED HOUSE MODEL
```

Everything else should be generated from that model:

```text
2D Plan
3D Model
Materials
Interior
Exterior
Elevations
Sections
Walkthrough
Drone View
Measurements
Area Calculations
Exports
```

Do not build separate disconnected systems.

---

# 74. IMPLEMENTATION INSTRUCTIONS

Before writing large amounts of code:

1. Inspect the existing project.
2. Determine the current technology stack.
3. Create a clear architecture.
4. Build the smallest functional vertical slice.
5. Run it.
6. Test it.
7. Fix errors.
8. Continue feature by feature.
9. Do not leave broken placeholder functionality.
10. Keep the application runnable after every major milestone.

When implementing a feature, make it actually functional before moving to the next feature.

Prioritize the core loop:

```text
CREATE HOUSE
→
DRAW/GENERATE FLOOR PLAN
→
EDIT
→
GENERATE 3D
→
CUSTOMIZE
→
SAVE
```

Then progressively add AI, materials, sketch recognition, walkthrough, drone mode, and advanced rendering.

The final result should be a **real desktop home-design application**, not a UI prototype.
