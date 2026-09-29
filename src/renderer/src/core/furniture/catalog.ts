import type { FurnitureCategory } from '../model/types'

/**
 * Furniture catalog (§18). Dimensions in meters: width (local x), depth (local y, front faces +y),
 * height. `mount` = where it sits; `plan` = 2D symbol; `model` = 3D builder.
 */
export interface CatalogItem {
  key: string
  name: string
  category: FurnitureCategory
  w: number
  d: number
  h: number
  elevation?: number
  resizable?: boolean
  plan: string
  model: string
  color?: string
}

const C = (key: string, name: string, category: FurnitureCategory, w: number, d: number, h: number, plan: string, model = plan, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  key,
  name,
  category,
  w,
  d,
  h,
  plan,
  model,
  resizable: true,
  ...extra
})

export const CATALOG: CatalogItem[] = [
  // Beds
  C('bed-king', 'King bed', 'beds', 1.93, 2.13, 1.1, 'bed', 'bed', { color: '#e9e4da' }),
  C('bed-queen', 'Queen bed', 'beds', 1.6, 2.1, 1.05, 'bed', 'bed', { color: '#e9e4da' }),
  C('bed-double', 'Double bed', 'beds', 1.4, 2.0, 1.0, 'bed', 'bed', { color: '#e9e4da' }),
  C('bed-single', 'Single bed', 'beds', 1.0, 2.0, 0.95, 'bed-single', 'bed', { color: '#e6ebf0' }),
  C('bed-bunk', 'Bunk bed', 'beds', 1.0, 2.0, 1.65, 'bed-single', 'bunk'),
  C('crib', 'Baby crib', 'beds', 0.7, 1.3, 0.95, 'bed-single', 'crib'),
  C('nightstand', 'Nightstand', 'tables', 0.5, 0.42, 0.55, 'box', 'cabinet'),
  // Sofas
  C('sofa-3', 'Three-seat sofa', 'sofas', 2.2, 0.92, 0.82, 'sofa', 'sofa', { color: '#8c8d8f' }),
  C('sofa-2', 'Loveseat', 'sofas', 1.6, 0.9, 0.82, 'sofa', 'sofa', { color: '#8c8d8f' }),
  C('sofa-l', 'L-shaped sofa', 'sofas', 2.8, 1.8, 0.82, 'sofa-l', 'sofa-l', { color: '#8c8d8f' }),
  C('armchair', 'Armchair', 'sofas', 0.85, 0.85, 0.85, 'armchair', 'armchair', { color: '#a88c6c' }),
  C('ottoman', 'Ottoman', 'sofas', 0.6, 0.6, 0.42, 'box', 'ottoman'),
  // Dining
  C('dining-4', 'Dining set for 4', 'dining', 1.2, 1.9, 0.76, 'dining', 'dining'),
  C('dining-6', 'Dining set for 6', 'dining', 1.8, 1.95, 0.76, 'dining', 'dining'),
  C('dining-8', 'Dining set for 8', 'dining', 2.4, 2.0, 0.76, 'dining', 'dining'),
  C('sideboard', 'Sideboard', 'cabinets', 1.6, 0.45, 0.8, 'box', 'cabinet'),
  // Chairs & tables
  C('chair', 'Chair', 'chairs', 0.48, 0.5, 0.9, 'chair', 'chair'),
  C('office-chair', 'Office chair', 'chairs', 0.62, 0.62, 1.05, 'chair', 'office-chair'),
  C('coffee-table', 'Coffee table', 'tables', 1.2, 0.6, 0.42, 'table', 'table-low'),
  C('side-table', 'Side table', 'tables', 0.5, 0.5, 0.55, 'table', 'table-low'),
  C('console', 'Console table', 'tables', 1.2, 0.38, 0.8, 'box', 'table'),
  C('table', 'Table', 'tables', 1.2, 0.8, 0.75, 'table', 'table'),
  // TV
  C('tv-unit', 'TV unit', 'tv', 1.9, 0.45, 0.5, 'tv', 'tv-unit'),
  C('tv-wall', 'Wall TV panel', 'tv', 2.4, 0.12, 1.6, 'tv', 'tv-wall', { elevation: 0.3 }),
  // Storage
  C('wardrobe', 'Wardrobe', 'wardrobes', 1.8, 0.62, 2.2, 'wardrobe', 'wardrobe'),
  C('wardrobe-large', 'Large wardrobe', 'wardrobes', 2.4, 0.62, 2.3, 'wardrobe', 'wardrobe'),
  C('dresser', 'Dresser', 'cabinets', 1.2, 0.5, 0.8, 'box', 'cabinet'),
  C('cabinet', 'Cabinet', 'cabinets', 1.0, 0.45, 0.9, 'box', 'cabinet'),
  C('shoe-cabinet', 'Shoe cabinet', 'cabinets', 1.0, 0.35, 1.0, 'box', 'cabinet'),
  C('shelving', 'Storage shelving', 'cabinets', 1.2, 0.45, 2.0, 'shelf', 'shelf'),
  // Kitchen
  C('kitchen-run', 'Kitchen counter', 'kitchen', 2.4, 0.62, 0.9, 'counter', 'counter'),
  C('kitchen-sink', 'Counter with sink', 'kitchen', 1.8, 0.62, 0.9, 'counter-sink', 'counter-sink'),
  C('kitchen-hob', 'Counter with hob', 'kitchen', 1.8, 0.62, 0.9, 'counter-hob', 'counter-hob'),
  C('fridge', 'Refrigerator', 'kitchen', 0.8, 0.72, 1.85, 'fridge', 'fridge'),
  C('island', 'Kitchen island', 'kitchen', 1.8, 0.95, 0.92, 'island', 'island'),
  // Bath
  C('bathtub', 'Bathtub', 'bathtubs', 1.7, 0.78, 0.58, 'bathtub', 'bathtub'),
  C('shower', 'Shower', 'showers', 0.95, 0.95, 2.0, 'shower', 'shower'),
  C('wc', 'Toilet', 'toilets', 0.42, 0.7, 0.78, 'wc', 'wc'),
  C('vanity', 'Vanity basin', 'sinks', 0.9, 0.5, 0.85, 'basin', 'vanity'),
  C('basin', 'Wash basin', 'sinks', 0.55, 0.45, 0.85, 'basin', 'vanity'),
  // Work
  C('desk', 'Desk', 'desks', 1.4, 0.7, 0.75, 'desk', 'desk'),
  C('study-desk', 'Study desk', 'desks', 1.2, 0.6, 0.75, 'desk', 'desk'),
  C('bookshelf', 'Bookshelf', 'bookshelves', 1.0, 0.35, 2.0, 'shelf', 'bookshelf'),
  // Outdoor
  C('outdoor-sofa', 'Outdoor sofa', 'outdoor', 2.0, 0.85, 0.75, 'sofa', 'sofa', { color: '#c9c3b6' }),
  C('outdoor-set', 'Outdoor table set', 'outdoor', 1.6, 1.6, 0.75, 'dining', 'dining'),
  C('lounger', 'Sun lounger', 'outdoor', 0.7, 1.95, 0.4, 'lounger', 'lounger'),
  C('planter', 'Planter', 'outdoor', 0.5, 0.5, 0.9, 'plant', 'plant'),
  // Decor
  C('rug', 'Rug', 'decor', 2.4, 1.7, 0.01, 'rug', 'rug'),
  C('plant', 'Indoor plant', 'decor', 0.45, 0.45, 1.2, 'plant', 'plant'),
  C('floor-lamp', 'Floor lamp', 'lighting', 0.35, 0.35, 1.6, 'lamp', 'lamp'),
  C('wall-art', 'Wall art', 'decor', 1.0, 0.04, 0.7, 'art', 'art', { elevation: 1.3 }),
  // Vehicles & garage
  C('car', 'Car', 'vehicles', 1.82, 4.6, 1.45, 'car', 'car', { resizable: false }),
  C('suv', 'SUV', 'vehicles', 1.95, 4.85, 1.75, 'car', 'car', { resizable: false }),
  C('ev-charger', 'EV charger', 'appliances', 0.3, 0.2, 0.45, 'box', 'ev-charger', { elevation: 1.0 }),
  C('workbench', 'Workbench', 'tables', 1.8, 0.65, 0.92, 'box', 'workbench'),
  // Appliances
  C('washer', 'Washing machine', 'appliances', 0.6, 0.6, 0.85, 'washer', 'washer'),
  C('dryer', 'Dryer', 'appliances', 0.6, 0.6, 0.85, 'washer', 'washer'),
  C('water-heater', 'Water heater', 'appliances', 0.55, 0.55, 1.4, 'circle', 'tank'),
  C('water-tank', 'Water tank', 'appliances', 1.3, 1.3, 1.4, 'circle', 'tank'),
  C('solar-panel', 'Solar panel', 'appliances', 1.05, 2.1, 0.9, 'solar', 'solar'),
  // Fitness & leisure
  C('treadmill', 'Treadmill', 'fitness', 0.85, 1.95, 1.4, 'box', 'treadmill'),
  C('bench-press', 'Weight bench', 'fitness', 1.2, 2.0, 1.2, 'box', 'bench'),
  C('exercise-bike', 'Exercise bike', 'fitness', 0.6, 1.2, 1.3, 'box', 'bike'),
  C('theater-row', 'Theater seats', 'sofas', 3.2, 0.95, 1.0, 'sofa', 'theater'),
  C('screen', 'Projection screen', 'tv', 3.2, 0.1, 1.8, 'tv', 'screen', { elevation: 0.55 }),
  C('pool-table', 'Pool table', 'tables', 2.6, 1.5, 0.8, 'table', 'pool-table'),
  C('prayer-mat', 'Prayer mat', 'decor', 0.7, 1.2, 0.01, 'rug', 'rug', { color: '#6e2f2b' })
]

const MAP = new Map(CATALOG.map((c) => [c.key, c]))
export const catalogItem = (key: string) => MAP.get(key)

export const FURNITURE_CATEGORIES: { key: FurnitureCategory; label: string }[] = [
  { key: 'beds', label: 'Beds' },
  { key: 'sofas', label: 'Sofas' },
  { key: 'dining', label: 'Dining tables' },
  { key: 'chairs', label: 'Chairs' },
  { key: 'tables', label: 'Tables' },
  { key: 'tv', label: 'TV units' },
  { key: 'wardrobes', label: 'Wardrobes' },
  { key: 'cabinets', label: 'Cabinets' },
  { key: 'kitchen', label: 'Kitchen units' },
  { key: 'bathtubs', label: 'Bathtubs' },
  { key: 'showers', label: 'Showers' },
  { key: 'toilets', label: 'Toilets' },
  { key: 'sinks', label: 'Sinks' },
  { key: 'desks', label: 'Desks' },
  { key: 'bookshelves', label: 'Bookshelves' },
  { key: 'outdoor', label: 'Outdoor furniture' },
  { key: 'decor', label: 'Decor' },
  { key: 'lighting', label: 'Lighting' },
  { key: 'vehicles', label: 'Vehicles' },
  { key: 'appliances', label: 'Appliances' },
  { key: 'fitness', label: 'Fitness' }
]
