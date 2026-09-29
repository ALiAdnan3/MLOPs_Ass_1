/**
 * HomeForge AI — structured house model.
 *
 * This is the single source of truth (§52, §73). The 2D plan, 3D model, elevations, sections,
 * walkthrough, drone path, measurements, estimates and every export are derived from it.
 *
 * Coordinate system (plan): meters, x → right (plot frontage), y → down (towards the road).
 * The road/front of the plot is at y = plot.depth. 3D maps plan (x, y) → three (x, z), up = +y.
 */

export type ID = string

export interface Vec2 {
  x: number
  y: number
}

// ─── Units ──────────────────────────────────────────────────────────────────

export type LengthUnit = 'ft' | 'in' | 'm' | 'cm'
/** Display system. 'ft-in' shows 14′ 6″; 'ft' shows 14.5 ft. */
export type UnitSystem = 'ft-in' | 'ft' | 'm' | 'cm'
export type AreaUnit = 'sqft' | 'sqm' | 'marla' | 'kanal'

// ─── Rooms ──────────────────────────────────────────────────────────────────

export type Zone = 'public' | 'semi' | 'private' | 'service' | 'circulation' | 'outdoor' | 'void'

export type RoomType =
  | 'master_bedroom'
  | 'bedroom'
  | 'guest_bedroom'
  | 'kids_room'
  | 'bathroom'
  | 'powder'
  | 'kitchen'
  | 'dirty_kitchen'
  | 'dining'
  | 'tv_lounge'
  | 'drawing'
  | 'living'
  | 'family'
  | 'study'
  | 'office'
  | 'prayer'
  | 'laundry'
  | 'store'
  | 'pantry'
  | 'servant'
  | 'servant_bath'
  | 'walk_in_closet'
  | 'dressing'
  | 'foyer'
  | 'corridor'
  | 'stair'
  | 'lift'
  | 'garage'
  | 'terrace'
  | 'balcony'
  | 'courtyard'
  | 'home_theater'
  | 'gym'
  | 'game_room'
  | 'library'
  | 'basement_lounge'
  | 'mechanical'
  | 'wine_storage'
  | 'void'
  | 'mumty'
  | 'rooftop_garden'
  | 'custom'

export type CeilingType = 'flat' | 'false-ceiling' | 'cove' | 'coffered' | 'open'
export type LightFixtureKind = 'downlights' | 'chandelier' | 'panel' | 'cove' | 'pendant' | 'fan-light'

export interface RoomLighting {
  on: boolean
  fixture: LightFixtureKind
  /** 0..2, 1 = design default */
  intensity: number
  /** Kelvin */
  temperature: number
}

export interface Room {
  id: ID
  name: string
  /** When true, smart labeling may rename/renumber it (§60). Renaming sets it false. */
  autoName: boolean
  type: RoomType
  /** Centerline polygon (wall centerlines), meters, counter-clockwise not required. */
  polygon: Vec2[]
  floorMaterial?: ID
  wallMaterial?: ID
  ceilingMaterial?: ID
  ceilingType?: CeilingType
  /** Clear ceiling height override; default is floor height − slab. */
  ceilingHeight?: number
  /** Room opens through the floor above (double-height lounge / entrance). */
  doubleHeight?: boolean
  lighting?: RoomLighting
  /** Accent paint color used when wall material is paint. */
  color?: string
  curtains?: { enabled: boolean; color: string }
  /** Generator bookkeeping — which program item produced it. */
  programKey?: string
  /** Parent room for attached spaces (en-suite bath → bedroom). */
  parentId?: ID
  /** Room-designer furnishing switches (§17). Missing = design default. */
  furnish?: { bed?: boolean; wardrobe?: boolean; tv?: boolean; decor?: boolean; desk?: boolean; seating?: boolean }
  /** Garage: enclosed with walls + garage door (true) or open car porch (false). */
  enclosed?: boolean
  /** Void above an open courtyard (no roof, exterior-grade walls). */
  openToSky?: boolean
  /** Garage extras (§28). */
  garage?: { cars: number; storage: boolean; workshop: boolean; evCharger: boolean }
}

// ─── Walls & openings ───────────────────────────────────────────────────────

export type WallKind = 'exterior' | 'interior' | 'railing' | 'parapet' | 'virtual'

export interface Wall {
  id: ID
  a: Vec2
  b: Vec2
  thickness: number
  /** Height override (m). Default: floor height for full walls, 1.0 for railings. */
  height?: number
  /** Computed from adjacent rooms on rebuild. */
  kind: WallKind
  /** User override of the computed kind (e.g. turn an interior wall into an open/virtual separator). */
  kindOverride?: WallKind
  /** 'rooms' = derived from room boundaries; 'manual' = drawn by the user with the Wall tool. */
  source: 'rooms' | 'manual'
  /** True when the user changed the thickness; preserved across rebuilds. */
  thicknessLocked?: boolean
  /** Per-side finish overrides. left = side to the left walking a→b (normal = rotate(b−a, +90°) in y-down plan). */
  sideMaterials?: { left?: ID; right?: ID }
}

export type DoorStyle = 'single' | 'double' | 'sliding' | 'pocket' | 'garage' | 'opening' | 'french' | 'main'
export type WindowStyle = 'casement' | 'sliding' | 'fixed' | 'full-height' | 'ventilator' | 'arched' | 'corner'

export interface Opening {
  id: ID
  kind: 'door' | 'window'
  wallId: ID
  /** Distance from wall.a to the opening center, along the wall (m). */
  offset: number
  width: number
  height: number
  /** Sill height above finished floor (0 for doors). */
  sill: number
  style: DoorStyle | WindowStyle
  /** Hinge end along the wall for swing doors. */
  hinge?: 'start' | 'end'
  /** Wall side the leaf swings into. */
  swing?: 'left' | 'right'
  frameMaterial?: ID
  leafMaterial?: ID
}

// ─── Structure ──────────────────────────────────────────────────────────────

export interface Column {
  id: ID
  position: Vec2
  width: number
  depth: number
  rotation: number
  shape: 'rect' | 'round'
  material?: ID
  /** Visible (porch/feature) column vs. embedded structural column. */
  exposed?: boolean
}

export interface Beam {
  id: ID
  a: Vec2
  b: Vec2
  width: number
  depth: number
}

export type StairType = 'straight' | 'L' | 'U' | 'spiral' | 'floating' | 'modern' | 'traditional'
export type RailingType = 'glass' | 'metal' | 'wood' | 'none'

export interface Stair {
  id: ID
  type: StairType
  /** Bounding-box corner the stair starts from (bottom step), in plan. */
  position: Vec2
  /** Rotation of the stair's local frame (radians). Local +y = walking direction of first flight. */
  rotation: number
  /** Flight width (m). */
  width: number
  /** Number of risers to reach the floor above. */
  risers: number
  /** Tread depth (going), m. */
  tread: number
  /** For L and U: turn direction. */
  turn: 'left' | 'right'
  material?: ID
  railing: RailingType
  railingMaterial?: ID
}

// ─── Furniture ──────────────────────────────────────────────────────────────

export type FurnitureCategory =
  | 'beds'
  | 'sofas'
  | 'dining'
  | 'chairs'
  | 'tables'
  | 'tv'
  | 'wardrobes'
  | 'cabinets'
  | 'kitchen'
  | 'bathtubs'
  | 'showers'
  | 'toilets'
  | 'sinks'
  | 'desks'
  | 'bookshelves'
  | 'outdoor'
  | 'decor'
  | 'vehicles'
  | 'appliances'
  | 'fitness'
  | 'lighting'

export interface FurnitureItem {
  id: ID
  /** Catalog key, e.g. 'bed-king'. */
  type: string
  position: Vec2
  rotation: number
  width: number
  depth: number
  height: number
  /** Height of the item's base above the floor (wall cabinets, TVs). */
  elevation?: number
  materialId?: ID
  color?: string
  label?: string
}

// ─── Annotations ────────────────────────────────────────────────────────────

export type Annotation =
  | { id: ID; kind: 'dimension'; a: Vec2; b: Vec2; offset: number }
  | { id: ID; kind: 'text'; position: Vec2; text: string; size: number }

// ─── Floors ─────────────────────────────────────────────────────────────────

export type FloorKind = 'basement' | 'ground' | 'upper' | 'roof'

export interface Floor {
  id: ID
  name: string
  kind: FloorKind
  /** −1 basement, 0 ground, 1 first, 2 second … roof = top + 1 */
  level: number
  /** Floor-to-floor height (m). */
  height: number
  slabThickness: number
  visible: boolean
  rooms: Room[]
  walls: Wall[]
  openings: Opening[]
  columns: Column[]
  beams: Beam[]
  stairs: Stair[]
  furniture: FurnitureItem[]
  annotations: Annotation[]
}

// ─── Plot & site ────────────────────────────────────────────────────────────

export type Compass = 'N' | 'E' | 'S' | 'W'

export interface Gate {
  id: ID
  /** Center offset along the front edge from the left plot corner (m). */
  offset: number
  width: number
  type: 'sliding' | 'swing' | 'pedestrian'
  side: 'front' | 'left' | 'right'
}

export interface Plot {
  presetId?: string
  /** Frontage (m). */
  width: number
  /** Depth from rear boundary to road (m). */
  depth: number
  shape: 'rect' | 'irregular'
  /** Boundary polygon; for rect plots it mirrors width × depth. */
  polygon: Vec2[]
  /** Compass direction the road side faces. */
  roadSide: Compass
  /** Extra rotation of true north relative to the road convention (deg). */
  northOffset: number
  corner: boolean
  cornerSide: 'left' | 'right'
  setbacks: { front: number; rear: number; left: number; right: number }
  roadWidth: number
  boundaryWall: { enabled: boolean; height: number; thickness: number; material?: ID }
  gates: Gate[]
}

export type SiteAreaKind =
  | 'lawn'
  | 'patio'
  | 'driveway'
  | 'walkway'
  | 'pool'
  | 'garden_bed'
  | 'deck'
  | 'play_area'
  | 'bbq_area'
  | 'outdoor_kitchen'
  | 'outdoor_sitting'
  | 'water_feature'
  | 'light_well'

export interface SiteArea {
  id: ID
  kind: SiteAreaKind
  name?: string
  polygon: Vec2[]
  material?: ID
  /** Pool / light-well depth (m). */
  depth?: number
}

export type SiteObjectKind =
  | 'tree'
  | 'palm'
  | 'shrub'
  | 'flowers'
  | 'hedge'
  | 'pergola'
  | 'bench'
  | 'outdoor_table'
  | 'lounger'
  | 'umbrella'
  | 'bbq_grill'
  | 'fountain'
  | 'swing'
  | 'slide'
  | 'garden_light'
  | 'lamp_post'
  | 'planter'
  | 'water_tank'
  | 'solar_panel'

export interface SiteObject {
  id: ID
  kind: SiteObjectKind
  position: Vec2
  rotation: number
  scale: number
  width?: number
  depth?: number
}

export interface Site {
  areas: SiteArea[]
  objects: SiteObject[]
}

// ─── Exterior ───────────────────────────────────────────────────────────────

export type ArchitecturalStyle =
  | 'modern'
  | 'contemporary'
  | 'minimalist'
  | 'traditional'
  | 'luxury'
  | 'islamic'
  | 'mediterranean'
  | 'european'
  | 'colonial'
  | 'industrial'
  | 'farmhouse'
  | 'pakistani_modern'
  | 'custom'

export type RoofType = 'flat' | 'hip' | 'gable' | 'shed' | 'mansard'

export interface Exterior {
  style: ArchitecturalStyle
  facadeMaterial: ID
  accentMaterial: ID
  /** Where the accent cladding goes. */
  accent: 'none' | 'front-feature' | 'entrance' | 'stair-tower' | 'ground-floor'
  plinthMaterial: ID
  roofType: RoofType
  roofMaterial: ID
  parapetHeight: number
  windowFrameMaterial: ID
  /** Multiplies generated window widths (facade editing). */
  windowScale: number
  entranceCanopy: boolean
  columnStyle: 'square' | 'round' | 'classical'
  lighting: {
    facadeWash: boolean
    verticalStrips: boolean
    gardenLights: boolean
    gateLights: boolean
    /** Kelvin */
    temperature: number
  }
}

// ─── Materials ──────────────────────────────────────────────────────────────

export type MaterialCategory =
  | 'marble'
  | 'granite'
  | 'ceramic'
  | 'porcelain'
  | 'wood'
  | 'concrete'
  | 'brick'
  | 'stone'
  | 'paint'
  | 'metal'
  | 'glass'
  | 'roof'
  | 'wallpaper'
  | 'ground'
  | 'fabric'

export type ProceduralKind =
  | 'marble'
  | 'granite'
  | 'tiles'
  | 'wood'
  | 'parquet'
  | 'concrete'
  | 'brick'
  | 'stone'
  | 'slate'
  | 'plaster'
  | 'metal'
  | 'glass'
  | 'roof-tiles'
  | 'shingles'
  | 'standing-seam'
  | 'wallpaper'
  | 'grass'
  | 'water'
  | 'asphalt'
  | 'pavers'
  | 'gravel'
  | 'fabric'
  | 'terrazzo'

export interface MaterialAnalysis {
  textureType: MaterialCategory
  confidence: number
  pattern: 'none' | 'tiles' | 'planks' | 'bricks' | 'veins' | 'speckled' | 'stripes'
  tileSize?: number
  dominantColors: string[]
  averageColor: string
  roughness: number
  reflectivity: number
  scale: number
  notes: string[]
}

export interface MaterialDef {
  id: ID
  name: string
  category: MaterialCategory
  source: 'library' | 'upload' | 'custom'
  /** Base tint (multiplied with texture). */
  color: string
  procedural?: { kind: ProceduralKind; seed: number; colors: string[]; params?: Record<string, number> }
  /** Uploaded image asset id (base color). */
  assetId?: ID
  /** Generated PBR maps (asset ids). */
  maps?: { normal?: ID; roughness?: ID; height?: ID }
  /** Real-world size of one texture repeat (m). */
  scale: number
  /** Degrees. */
  rotation: number
  offset: Vec2
  roughness: number
  metalness: number
  /** 0..1 — clearcoat/polish and environment reflection strength. */
  reflection: number
  brightness: number
  contrast: number
  normalStrength: number
  opacity?: number
  analysis?: MaterialAnalysis
}

// ─── Cameras, designs, versions ─────────────────────────────────────────────

export interface CameraBookmark {
  id: ID
  name: string
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

export type DesignStrategy = 'family' | 'luxury-open' | 'privacy' | 'garden' | 'room-space' | 'custom'

export interface DesignScores {
  privacy: number
  light: number
  garden: number
  space: number
  efficiency: number
  overall: number
}

export interface DesignStats {
  plotArea: number
  coveredArea: number
  openArea: number
  totalFloorArea: number
  gardenArea: number
  bedrooms: number
  bathrooms: number
  parking: number
  floors: number
  rooms: number
}

/** A self-contained house state (what a design, template or version snapshot holds). */
export interface HouseState {
  plot: Plot
  floors: Floor[]
  site: Site
  exterior: Exterior
}

export interface DesignOption {
  id: ID
  label: string
  name: string
  strategy: DesignStrategy
  seed: number
  house: HouseState
  explanation: string[]
  stats: DesignStats
  scores: DesignScores
  warnings: string[]
  createdAt: number
}

export interface Version {
  id: ID
  number: number
  name: string
  createdAt: number
  house: HouseState
  materials: MaterialDef[]
}

export interface ConceptImage {
  id: ID
  title: string
  assetId: ID
  createdAt: number
  prompt?: string
}

// ─── Requirements (wizard) ──────────────────────────────────────────────────

export type FloorsOption =
  | 'single'
  | 'double'
  | 'triple'
  | 'basement+ground'
  | 'basement+ground+first'
  | 'basement+ground+first+second'
  | 'custom'

export type StairPreference = 'auto' | StairType

export interface RoomCounts {
  bedrooms: number
  masterBedrooms: number
  guestBedrooms: number
  bathrooms: number
  powderRooms: number
  kitchens: number
  dirtyKitchens: number
  diningRooms: number
  tvLounges: number
  drawingRooms: number
  livingRooms: number
  familyRooms: number
  studyRooms: number
  offices: number
  kidsRooms: number
  prayerRooms: number
  laundries: number
  stores: number
  pantries: number
  servantRooms: number
  servantBathrooms: number
  walkInClosets: number
  dressingRooms: number
}

export interface OutdoorRequirements {
  garage: boolean
  cars: number
  frontLawn: boolean
  backLawn: boolean
  courtyard: boolean
  patio: boolean
  terrace: boolean
  balcony: boolean
  pool: boolean
  outdoorKitchen: boolean
  outdoorSitting: boolean
  garden: boolean
  playArea: boolean
  bbq: boolean
}

export interface SpecialRequirements {
  basement: boolean
  doubleHeightLounge: boolean
  doubleHeightEntrance: boolean
  centralCourtyard: boolean
  largeWindows: boolean
  skylight: boolean
  atrium: boolean
  stairType: StairPreference
  elevator: boolean
  homeTheater: boolean
  gym: boolean
  gameRoom: boolean
  library: boolean
  office: boolean
  rooftopGarden: boolean
}

export interface Preferences {
  privacy: number
  naturalLight: number
  ventilation: number
  openSpace: number
  luxury: number
  greenSpace: number
  parking: number
  entertainment: number
  familySpace: number
}

export interface Requirements {
  floors: FloorsOption
  customFloors: { basement: boolean; above: number }
  rooms: RoomCounts
  outdoor: OutdoorRequirements
  special: SpecialRequirements
  style: ArchitecturalStyle
  customStyle?: string
  preferences: Preferences
}

// ─── Settings ───────────────────────────────────────────────────────────────

export type Quality = 'low' | 'medium' | 'high' | 'ultra'
export type LayerKey =
  | 'architecture'
  | 'structure'
  | 'furniture'
  | 'electrical'
  | 'plumbing'
  | 'landscape'
  | 'lighting'
  | 'materials'
  | 'annotations'

export interface LightingSettings {
  preset: 'morning' | 'noon' | 'afternoon' | 'sunset' | 'night' | 'custom'
  /** Hours, 0..24 */
  time: number
  latitude: number
  /** Day of year 1..365 */
  dayOfYear: number
  interiorLights: boolean
  exteriorLights: boolean
}

export interface CostRates {
  region: 'pakistan' | 'uae' | 'uk' | 'usa' | 'custom'
  currency: string
  /** Rates per m² unless noted. */
  structure: number
  flooring: number
  marble: number
  wallFinish: number
  paint: number
  exterior: number
  roofing: number
  landscaping: number
  electrical: number
  plumbing: number
  /** Per unit */
  door: number
  window: number
  kitchen: number
  bathroom: number
}

export interface ProjectSettings {
  units: UnitSystem
  areaUnit: AreaUnit
  /** Square feet per marla (225 standard, 272.25 traditional). */
  marlaSqft: number
  /** Grid spacing (m). */
  grid: number
  snap: { grid: boolean; walls: boolean; objects: boolean; guides: boolean; dimensions: boolean }
  layers: Record<LayerKey, boolean>
  wallThickness: { exterior: number; interior: number }
  floorHeight: number
  plinthHeight: number
  lighting: LightingSettings
  autoVersion: boolean
}

// ─── Project ────────────────────────────────────────────────────────────────

export interface Project {
  schema: 1
  id: ID
  name: string
  createdAt: number
  updatedAt: number
  plot: Plot
  requirements: Requirements
  floors: Floor[]
  site: Site
  exterior: Exterior
  /** Custom and uploaded materials (library materials are referenced by id). */
  materials: MaterialDef[]
  cameras: CameraBookmark[]
  designs: DesignOption[]
  activeDesignId?: ID
  versions: Version[]
  conceptImages: ConceptImage[]
  settings: ProjectSettings
  costRates: CostRates
}

// ─── Selection references ───────────────────────────────────────────────────

export type EntityKind =
  | 'room'
  | 'wall'
  | 'opening'
  | 'column'
  | 'stair'
  | 'furniture'
  | 'annotation'
  | 'siteArea'
  | 'siteObject'
  | 'plot'
  | 'gate'

export interface EntityRef {
  kind: EntityKind
  id: ID
  floorId?: ID
}

/** A paintable surface in 3D (§13 "selected surface"). */
export type SurfaceRef =
  | { kind: 'roomFloor'; floorId: ID; roomId: ID }
  | { kind: 'roomCeiling'; floorId: ID; roomId: ID }
  | { kind: 'wallSide'; floorId: ID; wallId: ID; side: 'left' | 'right'; roomId?: ID }
  | { kind: 'exteriorWall'; floorId?: ID; wallId?: ID }
  | { kind: 'stair'; floorId: ID; stairId: ID }
  | { kind: 'column'; floorId: ID; columnId: ID }
  | { kind: 'furniture'; floorId: ID; furnitureId: ID }
  | { kind: 'roof' }
  | { kind: 'siteArea'; areaId: ID }
  | { kind: 'boundaryWall' }
