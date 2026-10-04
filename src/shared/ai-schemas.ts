/**
 * Structured-output schemas for the optional Claude integration. The renderer applies the
 * returned JSON with the same executors the offline parser uses, so Claude never touches the
 * model directly — it only proposes typed changes.
 */

export const REQUIREMENT_FIELDS = [
  'plot.preset',
  'plot.widthFt',
  'plot.depthFt',
  'plot.corner',
  'plot.roadSide',
  'floors',
  'style',
  'rooms.bedrooms',
  'rooms.masterBedrooms',
  'rooms.guestBedrooms',
  'rooms.bathrooms',
  'rooms.powderRooms',
  'rooms.kitchens',
  'rooms.dirtyKitchens',
  'rooms.diningRooms',
  'rooms.tvLounges',
  'rooms.drawingRooms',
  'rooms.livingRooms',
  'rooms.familyRooms',
  'rooms.studyRooms',
  'rooms.offices',
  'rooms.kidsRooms',
  'rooms.prayerRooms',
  'rooms.laundries',
  'rooms.stores',
  'rooms.pantries',
  'rooms.servantRooms',
  'rooms.servantBathrooms',
  'rooms.walkInClosets',
  'rooms.dressingRooms',
  'outdoor.garage',
  'outdoor.cars',
  'outdoor.frontLawn',
  'outdoor.backLawn',
  'outdoor.courtyard',
  'outdoor.patio',
  'outdoor.terrace',
  'outdoor.balcony',
  'outdoor.pool',
  'outdoor.outdoorKitchen',
  'outdoor.outdoorSitting',
  'outdoor.garden',
  'outdoor.playArea',
  'outdoor.bbq',
  'special.basement',
  'special.doubleHeightLounge',
  'special.doubleHeightEntrance',
  'special.centralCourtyard',
  'special.largeWindows',
  'special.skylight',
  'special.atrium',
  'special.stairType',
  'special.elevator',
  'special.homeTheater',
  'special.gym',
  'special.gameRoom',
  'special.library',
  'special.office',
  'special.rooftopGarden',
  'preferences.privacy',
  'preferences.naturalLight',
  'preferences.ventilation',
  'preferences.openSpace',
  'preferences.luxury',
  'preferences.greenSpace',
  'preferences.parking',
  'preferences.entertainment',
  'preferences.familySpace'
] as const

export const requirementsSchema = {
  type: 'object',
  properties: {
    updates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: [...REQUIREMENT_FIELDS] },
          number: { type: ['number', 'null'] },
          boolean: { type: ['boolean', 'null'] },
          text: { type: ['string', 'null'] }
        },
        required: ['field', 'number', 'boolean', 'text'],
        additionalProperties: false
      }
    },
    summary: { type: 'string' },
    unclear: { type: 'array', items: { type: 'string' } }
  },
  required: ['updates', 'summary', 'unclear'],
  additionalProperties: false
} as const

export const EDIT_OPS = [
  'resize_room',
  'set_room_size',
  'move_room_near',
  'swap_rooms',
  'add_room',
  'add_room_beside',
  'remove_room',
  'rename_room',
  'change_room_type',
  'set_garage_cars',
  'set_floor_height',
  'adjust_floor_height',
  'scale_site_area',
  'add_site_area',
  'set_exterior_material',
  'set_room_material',
  'apply_uploaded_material',
  'set_style',
  'set_roof',
  'set_window_scale',
  'add_window',
  'add_floor',
  'add_basement',
  'set_requirement',
  'regenerate',
  'improve_layout',
  'add_exterior_lighting',
  'set_solar',
  'answer'
] as const

export const editSchema = {
  type: 'object',
  properties: {
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: [...EDIT_OPS] },
          target: { type: ['string', 'null'], description: 'Room name or id, floor name, site area kind, or surface' },
          other: { type: ['string', 'null'], description: 'Second room (for move_room_near / swap_rooms / add_room_beside)' },
          amount: { type: ['number', 'null'], description: 'Numeric amount (feet unless unit says otherwise)' },
          unit: { type: ['string', 'null'], enum: ['ft', 'in', 'm', 'cm', 'percent', 'count', null] },
          axis: { type: ['string', 'null'], enum: ['width', 'length', 'both', null] },
          value: { type: ['string', 'null'], description: 'Name, room type, material id/category, style, roof type, requirement field…' }
        },
        required: ['op', 'target', 'other', 'amount', 'unit', 'axis', 'value'],
        additionalProperties: false
      }
    },
    reply: { type: 'string', description: 'Short explanation for the user of what will change' }
  },
  required: ['operations', 'reply'],
  additionalProperties: false
} as const

export const REQUIREMENTS_SYSTEM = `You convert a homeowner's description of the house they want into structured requirement updates for HomeForge AI, a house design app used mostly in Pakistan.
Plot sizes: 1 marla = 225 sq ft; presets are 3-marla, 5-marla, 7-marla, 8-marla, 10-marla, 12-marla, 15-marla, 1-kanal (20 marla), 2-kanal, 4-kanal — use plot.preset with text set to the preset id, or plot.widthFt/plot.depthFt for explicit dimensions.
floors text values: single, double, triple, basement+ground, basement+ground+first, basement+ground+first+second.
style text values: modern, contemporary, minimalist, traditional, luxury, islamic, mediterranean, european, colonial, industrial, farmhouse, pakistani_modern.
special.stairType text values: auto, straight, L, U, spiral, floating, modern, traditional.
Preferences are 0-100 ("high privacy" ≈ 85, "some" ≈ 60, "low" ≈ 25).
Only emit updates for things the text states or clearly implies. "Double storey" = floors double; "dirty kitchen" = rooms.dirtyKitchens; "2 car parking" = outdoor.garage true and outdoor.cars 2; "lawn" in front = outdoor.frontLawn.
Counts go in number, yes/no in boolean, enumerations in text; leave the other two null. List anything ambiguous in unclear.`

export const EDIT_SYSTEM = `You translate a homeowner's instruction into edit operations on their HomeForge AI house model.
You receive the current model summary (floors, rooms with ids, names, types and sizes in feet, site areas, exterior settings) and the instruction.
Rules:
- Use exact room ids from the summary in target/other when you can.
- Sizes: amount in feet unless the user used meters (unit "m") or percent.
- resize_room grows/shrinks by amount along axis; set_room_size sets an absolute size.
- move_room_near: target moves next to other. add_room_beside: value = room type (bathroom, store, study, …), other = neighbour room.
- set_garage_cars: amount = number of cars. adjust_floor_height: amount = change in feet (all floors when target is null).
- scale_site_area: target = patio | lawn | pool | driveway | deck, amount = percent change.
- add_site_area: target = pool | patio | play_area | bbq_area | garden_bed.
- set_exterior_material / set_room_material: value = a material category (stone, marble, brick, wood, concrete, paint, granite, tiles) or library id; for set_room_material put the surface (floor, walls, ceiling) in axis-free text after a colon in value, e.g. "floor:marble".
- apply_uploaded_material: the user refers to "this marble/material" they uploaded; target = room, value = surface.
- set_style: value = architectural style. set_roof: value = flat | hip | gable | shed | mansard. set_window_scale: amount = multiplier (1.3 = 30% larger).
- set_requirement + regenerate for changes that need a new layout (e.g. more bedrooms): value = "field=value".
- set_solar: rooftop solar panels; amount = system size in kW (0 removes them), or value "fill" to cover the open roof.
- improve_layout fixes validation problems; answer = the user only asked a question (put the answer in reply).
Keep reply to one or two sentences describing the change.`

/** Amendment A5: reading hand-written labels and dimensions on a sketch or plan photo. */
export const READ_PLAN_SYSTEM = `You read floor-plan drawings for HomeForge AI: hand sketches, scans and photos of house plans, mostly from Pakistan.
Report every piece of writing that names a room or gives a size, with where it sits on the image.
Positions are fractions of the image: x from 0 (left edge) to 1 (right edge), y from 0 (top) to 1 (bottom), at the centre of the text.
Rooms: give the text as written but expanded to plain English if abbreviated (MBR = master bedroom, D/R = drawing room, T.V. lounge, K = kitchen, W.C. or Toilet = bathroom, Lobby, Store, Porch = garage).
Dimensions: sizes written inside or beside a room, e.g. 12'x14', 12'-6" x 14', 4.2 x 5 m. Put the two numbers in feet in widthFt and lengthFt (convert metres; inches become fractions of a foot).
overallWidthFt / overallDepthFt: the plot or building's overall width and depth if a dimension line along the whole drawing states them; otherwise null.
Never guess text you cannot read; leave it out.`

export const readPlanSchema = {
  type: 'object',
  properties: {
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } },
        required: ['name', 'x', 'y'],
        additionalProperties: false
      }
    },
    dimensions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, widthFt: { type: 'number' }, lengthFt: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' } },
        required: ['text', 'widthFt', 'lengthFt', 'x', 'y'],
        additionalProperties: false
      }
    },
    overallWidthFt: { type: ['number', 'null'] },
    overallDepthFt: { type: ['number', 'null'] }
  },
  required: ['rooms', 'dimensions', 'overallWidthFt', 'overallDepthFt'],
  additionalProperties: false
} as const

export interface ReadPlanResult {
  rooms: { name: string; x: number; y: number }[]
  dimensions: { text: string; widthFt: number; lengthFt: number; x: number; y: number }[]
  overallWidthFt: number | null
  overallDepthFt: number | null
}
