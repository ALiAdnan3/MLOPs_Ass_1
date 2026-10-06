import type {
  ArchitecturalStyle,
  CostRates,
  DesignStrategy,
  Exterior,
  Floor,
  FloorKind,
  Plot,
  Project,
  ProjectSettings,
  Requirements
} from './types'
import { uid, type IdFactory } from './ids'
import { FT, ft } from '../units/units'
import { presetById, setbacksForArea } from '../units/plots'
import { rectPoly } from '../geometry/polygon'

export const DISCLAIMER =
  'Conceptual / preliminary design. Generated layouts, quantities and costs are approximate and must be reviewed by a qualified architect and structural engineer before construction or approval.'

export function makePlot(widthM: number, depthM: number, presetId?: string): Plot {
  const preset = presetById(presetId)
  const sb = preset
    ? { front: preset.setbacksFt.front * FT, rear: preset.setbacksFt.rear * FT, left: preset.setbacksFt.left * FT, right: preset.setbacksFt.right * FT }
    : setbacksForArea(widthM * depthM)
  return {
    presetId,
    width: widthM,
    depth: depthM,
    shape: 'rect',
    polygon: rectPoly({ x: 0, y: 0, w: widthM, h: depthM }),
    roadSide: 'S',
    northOffset: 0,
    corner: false,
    cornerSide: 'right',
    setbacks: sb,
    roadWidth: widthM > ft(60) ? ft(40) : ft(30),
    boundaryWall: { enabled: true, height: ft(7), thickness: 0.23, material: 'lib:render-ivory' },
    gates: []
  }
}

export function plotFromPreset(presetId: string): Plot {
  const p = presetById(presetId)!
  return makePlot(p.widthFt * FT, p.depthFt * FT, presetId)
}

export function floorName(kind: FloorKind, level: number): string {
  if (kind === 'basement') return 'Basement'
  if (kind === 'roof') return 'Roof'
  if (level === 0) return 'Ground'
  return ['Ground', 'First', 'Second', 'Third', 'Fourth', 'Fifth'][level] ?? `Level ${level}`
}

export function makeFloor(kind: FloorKind, level: number, height = ft(11), ids: IdFactory = uid): Floor {
  return {
    id: ids('flr'),
    name: floorName(kind, level),
    kind,
    level,
    height: kind === 'roof' ? ft(10) : kind === 'basement' ? ft(11) : height,
    slabThickness: 0.15,
    visible: true,
    rooms: [],
    walls: [],
    openings: [],
    columns: [],
    beams: [],
    stairs: [],
    furniture: [],
    annotations: []
  }
}

const STYLE_EXTERIOR: Record<ArchitecturalStyle, Partial<Exterior>> = {
  modern: { facadeMaterial: 'lib:render-white', accentMaterial: 'lib:stone-ledgestone', accent: 'front-feature', roofType: 'flat', windowFrameMaterial: 'lib:metal-black', columnStyle: 'square' },
  contemporary: { facadeMaterial: 'lib:render-ivory', accentMaterial: 'wood-panel', accent: 'front-feature', roofType: 'flat', windowFrameMaterial: 'lib:metal-black', columnStyle: 'square' },
  minimalist: { facadeMaterial: 'lib:render-white', accentMaterial: 'lib:concrete-board', accent: 'entrance', roofType: 'flat', windowFrameMaterial: 'lib:metal-aluminum', columnStyle: 'square' },
  traditional: { facadeMaterial: 'lib:render-ivory', accentMaterial: 'lib:brick-gutka', accent: 'ground-floor', roofType: 'flat', windowFrameMaterial: 'lib:wood-teak', columnStyle: 'round' },
  // modern luxury villa: slate hip roof, stone ground floor, timber feature panels, big black-framed glass
  luxury: { facadeMaterial: 'lib:render-white', accentMaterial: 'lib:stone-ledgestone', accent: 'ground-floor', accent2: { material: 'lib:wood-teak', placement: 'front-feature' }, roofType: 'hip', roofMaterial: 'lib:roof-slate', windowFrameMaterial: 'lib:metal-black', columnStyle: 'square', windowScale: 1.25 },
  // the original luxury look: marble cladding, brass frames, classical columns, flat roof
  luxury_classic: { facadeMaterial: 'lib:render-white', accentMaterial: 'lib:marble-botticino', accent: 'front-feature', roofType: 'flat', windowFrameMaterial: 'lib:metal-brass', columnStyle: 'classical' },
  islamic: { facadeMaterial: 'lib:render-ivory', accentMaterial: 'lib:stone-sandstone', accent: 'entrance', roofType: 'flat', windowFrameMaterial: 'lib:wood-walnut', columnStyle: 'round' },
  mediterranean: { facadeMaterial: 'lib:render-ivory', accentMaterial: 'lib:stone-travertine', accent: 'ground-floor', roofType: 'hip', roofMaterial: 'lib:roof-clay', windowFrameMaterial: 'lib:wood-walnut', columnStyle: 'round' },
  european: { facadeMaterial: 'lib:render-white', accentMaterial: 'lib:stone-limestone', accent: 'ground-floor', roofType: 'mansard', roofMaterial: 'lib:roof-slate', windowFrameMaterial: 'lib:paint-warm-white', columnStyle: 'classical' },
  colonial: { facadeMaterial: 'lib:render-white', accentMaterial: 'lib:brick-red', accent: 'none', roofType: 'gable', roofMaterial: 'lib:roof-slate', windowFrameMaterial: 'lib:paint-warm-white', columnStyle: 'classical' },
  industrial: { facadeMaterial: 'lib:brick-clinker', accentMaterial: 'lib:metal-corten', accent: 'front-feature', roofType: 'flat', windowFrameMaterial: 'lib:metal-black', columnStyle: 'square' },
  farmhouse: { facadeMaterial: 'lib:render-white', accentMaterial: 'lib:wood-oak', accent: 'entrance', roofType: 'gable', roofMaterial: 'lib:roof-standing-seam', windowFrameMaterial: 'lib:metal-black', columnStyle: 'square' },
  pakistani_modern: { facadeMaterial: 'lib:render-ivory', accentMaterial: 'lib:brick-gutka', accent: 'front-feature', roofType: 'flat', windowFrameMaterial: 'lib:metal-black', columnStyle: 'square' },
  custom: {}
}

/** How a design in each style is named on cards and in the presentation. */
export const STYLE_TITLE: Record<ArchitecturalStyle, string> = {
  modern: 'Modern Home',
  contemporary: 'Contemporary Design',
  minimalist: 'Minimalist Modern',
  traditional: 'Traditional Style',
  luxury: 'Modern Luxury Villa',
  luxury_classic: 'Classic Luxury (Marble)',
  islamic: 'Islamic Courtyard House',
  mediterranean: 'Mediterranean Villa',
  european: 'Classic Elegance',
  colonial: 'Colonial Classic',
  industrial: 'Industrial Townhouse',
  farmhouse: 'Modern Farmhouse',
  pakistani_modern: 'Pakistani Modern',
  custom: 'Custom Design'
}

/** "Show me different styles": each layout strategy gets its own look. */
export const MIX_STYLES: Partial<Record<DesignStrategy, ArchitecturalStyle>> = {
  'luxury-open': 'luxury',
  family: 'contemporary',
  'room-space': 'european',
  garden: 'minimalist',
  privacy: 'traditional'
}

export function exteriorForStyle(style: ArchitecturalStyle): Exterior {
  const base: Exterior = {
    style,
    facadeMaterial: 'lib:render-white',
    accentMaterial: 'lib:stone-ledgestone',
    accent: 'front-feature',
    plinthMaterial: 'lib:stone-slate',
    roofType: 'flat',
    roofMaterial: 'lib:roof-membrane',
    parapetHeight: ft(3.5),
    windowFrameMaterial: 'lib:metal-black',
    windowScale: 1,
    entranceCanopy: true,
    columnStyle: 'square',
    lighting: { facadeWash: true, verticalStrips: style === 'modern' || style === 'luxury' || style === 'luxury_classic' || style === 'contemporary', gardenLights: true, gateLights: true, temperature: style === 'luxury' ? 2700 : 3000 }
  }
  const s = { ...base, ...STYLE_EXTERIOR[style] }
  // 'wood-panel' shorthand
  if (s.accentMaterial === 'wood-panel') s.accentMaterial = 'lib:wood-teak'
  return s
}

export function defaultRequirements(): Requirements {
  return {
    floors: 'double',
    customFloors: { basement: false, above: 2 },
    rooms: {
      bedrooms: 4,
      masterBedrooms: 1,
      guestBedrooms: 1,
      bathrooms: 5,
      powderRooms: 1,
      kitchens: 1,
      dirtyKitchens: 0,
      diningRooms: 1,
      tvLounges: 1,
      drawingRooms: 1,
      livingRooms: 0,
      familyRooms: 1,
      studyRooms: 0,
      offices: 0,
      kidsRooms: 0,
      prayerRooms: 0,
      laundries: 1,
      stores: 1,
      pantries: 0,
      servantRooms: 0,
      servantBathrooms: 0,
      walkInClosets: 0,
      dressingRooms: 1
    },
    outdoor: {
      garage: true,
      cars: 2,
      frontLawn: true,
      backLawn: false,
      courtyard: false,
      patio: false,
      terrace: true,
      balcony: true,
      pool: false,
      outdoorKitchen: false,
      outdoorSitting: false,
      garden: true,
      playArea: false,
      bbq: false
    },
    special: {
      basement: false,
      doubleHeightLounge: false,
      doubleHeightEntrance: false,
      centralCourtyard: false,
      largeWindows: false,
      skylight: false,
      atrium: false,
      stairType: 'auto',
      elevator: false,
      homeTheater: false,
      gym: false,
      gameRoom: false,
      library: false,
      office: false,
      rooftopGarden: false
    },
    style: 'modern',
    preferences: {
      privacy: 60,
      naturalLight: 60,
      ventilation: 60,
      openSpace: 50,
      luxury: 50,
      greenSpace: 50,
      parking: 50,
      entertainment: 40,
      familySpace: 60
    }
  }
}

export function defaultSettings(): ProjectSettings {
  return {
    units: 'ft-in',
    areaUnit: 'sqft',
    marlaSqft: 225,
    grid: 0.5 * FT,
    snap: { grid: true, walls: true, objects: true, guides: true, dimensions: true },
    layers: {
      architecture: true,
      structure: true,
      furniture: true,
      electrical: false,
      plumbing: false,
      landscape: true,
      lighting: false,
      materials: false,
      annotations: true
    },
    wallThickness: { exterior: 0.23, interior: 0.115 },
    floorHeight: ft(11),
    plinthHeight: ft(1.5),
    lighting: { preset: 'afternoon', time: 15.5, latitude: 31.52, dayOfYear: 100, interiorLights: true, exteriorLights: true },
    autoVersion: true
  }
}

/** Regional unit rates (per m² unless noted). Clearly approximate (§46). */
export const COST_PRESETS: Record<CostRates['region'], CostRates> = {
  pakistan: { region: 'pakistan', currency: 'PKR', structure: 48000, flooring: 9000, marble: 14000, wallFinish: 2200, paint: 900, exterior: 5500, roofing: 3500, landscaping: 2500, electrical: 4500, plumbing: 4000, door: 85000, window: 38000, kitchen: 850000, bathroom: 450000 },
  uae: { region: 'uae', currency: 'AED', structure: 1900, flooring: 280, marble: 450, wallFinish: 90, paint: 35, exterior: 220, roofing: 160, landscaping: 120, electrical: 180, plumbing: 160, door: 3500, window: 1800, kitchen: 45000, bathroom: 22000 },
  uk: { region: 'uk', currency: 'GBP', structure: 1650, flooring: 85, marble: 180, wallFinish: 35, paint: 14, exterior: 120, roofing: 110, landscaping: 60, electrical: 95, plumbing: 85, door: 650, window: 900, kitchen: 18000, bathroom: 9500 },
  usa: { region: 'usa', currency: 'USD', structure: 1700, flooring: 95, marble: 210, wallFinish: 38, paint: 16, exterior: 140, roofing: 120, landscaping: 70, electrical: 110, plumbing: 100, door: 800, window: 950, kitchen: 25000, bathroom: 14000 },
  custom: { region: 'custom', currency: 'USD', structure: 1000, flooring: 50, marble: 100, wallFinish: 20, paint: 10, exterior: 80, roofing: 60, landscaping: 40, electrical: 60, plumbing: 60, door: 400, window: 500, kitchen: 10000, bathroom: 6000 }
}

export function newProject(name = 'My Dream House', plot?: Plot): Project {
  const now = Date.now()
  const settings = defaultSettings()
  const ground = makeFloor('ground', 0, settings.floorHeight)
  return {
    schema: 1,
    id: uid('prj'),
    name,
    createdAt: now,
    updatedAt: now,
    plot: plot ?? plotFromPreset('10-marla'),
    requirements: defaultRequirements(),
    floors: [ground],
    site: { areas: [], objects: [] },
    exterior: exteriorForStyle('modern'),
    materials: [],
    cameras: [],
    designs: [],
    versions: [],
    conceptImages: [],
    settings,
    costRates: { ...COST_PRESETS.pakistan }
  }
}
