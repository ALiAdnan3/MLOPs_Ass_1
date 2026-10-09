/**
 * AI PHOTOS (amendment A9): an optional, paid step that turns the app's own render of an area into
 * a photographic image with an OpenAI GPT Image model. The render goes in as the image to edit, so
 * the model keeps the real layout; the prompt forbids adding or moving anything.
 *
 * Shared by the main process (which calls the API with the user's key) and the tests.
 */

export type ImageModelId = 'gpt-image-2' | 'gpt-image-2.5-sunburst' | 'gpt-image-2.5-flare' | 'gpt-image-1.5'
export type ImageQuality = 'medium' | 'high' | 'xhigh'

export const IMAGE_MODELS: { id: ImageModelId; label: string; tip: string }[] = [
  { id: 'gpt-image-2', label: 'GPT Image 2', tip: 'Reads the render at high fidelity; the safest at keeping the layout' },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', tip: 'Newest model (September 2026); supports extra-high quality' },
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', tip: 'Newest model (September 2026); supports extra-high quality' },
  { id: 'gpt-image-1.5', label: 'GPT Image 1.5', tip: 'Older and cheaper' }
]

export interface AiImageRequest {
  /** The app's render of the area (PNG or JPEG bytes). */
  image: ArrayBuffer
  mediaType: 'image/png' | 'image/jpeg'
  prompt: string
  /** WIDTHxHEIGHT; 1536x1024 works with every GPT image model. */
  size: string
}

export type AiImageResponse = { ok: true; image: ArrayBuffer; mediaType: 'image/jpeg'; model: string } | { ok: false; error: string }

/**
 * The edit parameters for a model. `input_fidelity` is only sent to models that use it
 * (GPT Image 2 always reads inputs at high fidelity and ignores it); `xhigh` quality exists only
 * on the 2.5 models, so other models fall back to `high`.
 */
export function imageEditParams(model: ImageModelId, quality: ImageQuality, size: string) {
  const is25 = model.startsWith('gpt-image-2.5')
  const is2 = model === 'gpt-image-2'
  const legacySize = !is25 && !is2
  return {
    model,
    quality: quality === 'xhigh' && !is25 ? ('high' as const) : quality,
    size: legacySize && !['1024x1024', '1536x1024', '1024x1536'].includes(size) ? '1536x1024' : size,
    output_format: 'jpeg' as const,
    output_compression: 92,
    n: 1,
    ...(is2 ? {} : { input_fidelity: 'high' as const })
  }
}

export interface AreaPromptInput {
  /** e.g. "kitchen", "master bedroom", "front of the house". */
  area: string
  kind: 'interior' | 'exterior' | 'outdoor'
  /** e.g. "Modern Luxury Villa". */
  style: string
  city?: string
  /** Finishes visible in the render, in plain words: "white marble floor", "warm white walls". */
  finishes?: string[]
  light: 'day' | 'evening'
  /**
   * 'exact': realism only, nothing added. 'staged' (default): dressed like a property brochure with
   * decor, soft furnishings, plants and lighting, while the architecture and main furniture stay.
   */
  styling?: 'exact' | 'staged'
}

/** The instruction sent with the render: the design stays as drawn; how much dressing is allowed depends on `styling`. */
export function areaPrompt(o: AreaPromptInput): string {
  if ((o.styling ?? 'staged') === 'staged') return stagedPrompt(o)
  const where = o.city ? ` in ${o.city}, Pakistan` : ' in Pakistan'
  const finishes = o.finishes?.length ? ` The finishes are: ${o.finishes.join(', ')}.` : ''
  const keep =
    o.kind === 'interior'
      ? 'Keep exactly the same camera position and angle, the same room shape, walls, doors, windows, ceiling, stairs, furniture and their positions, and the same materials and colours.'
      : 'Keep exactly the same camera position and angle, the same building shape, number of floors, roof, windows, doors, balconies, boundary wall, gate, car porch, paths, lawns and planting positions, and the same materials and colours.'
  const light =
    o.kind === 'interior'
      ? o.light === 'evening'
        ? 'Light it as a calm evening: warm interior lighting, cove and pendant lights glowing, soft shadows.'
        : 'Light it with soft natural daylight through the windows, balanced with warm interior lights, soft shadows.'
      : o.light === 'evening'
        ? 'Light it at blue hour just after sunset: a glowing sky, warm facade and garden lights, lit windows.'
        : 'Light it on a clear afternoon with soft sun, a blue sky with light clouds and natural shadows.'
  return [
    `Turn this 3D render into a high-end, photorealistic architectural photograph of the ${o.area} of a ${o.style} house${where}.`,
    keep,
    `Improve only the realism: true-to-life textures (stone grain, wood grain, fabric, glass, metal), accurate reflections and ambient occlusion, natural imperfections, and a professional photographer's composition and exposure.${finishes}`,
    light,
    'Do not add, remove, move or resize any wall, opening, room, furniture or landscaping element. Do not change the design. Add no people, no text, no logos and no watermarks.'
  ].join(' ')
}

/** Brochure staging: the look of a luxury property magazine, on the house as designed. */
function stagedPrompt(o: AreaPromptInput): string {
  const where = o.city ? ` in ${o.city}, Pakistan` : ' in Pakistan'
  const finishes = o.finishes?.length ? ` Use these finishes: ${o.finishes.join(', ')}.` : ''
  const keep =
    o.kind === 'interior'
      ? 'Keep the same camera position and angle, the same room shape and size, every wall, door, window and the ceiling where they are, and the main furniture (beds, sofas, dining table, kitchen counters, wardrobes, bathroom fittings) in the same places.'
      : 'Keep the same camera position and angle, the same building shape, number of floors, roof form, every window, door and balcony where they are, the boundary wall, gate, car porch and the layout of paths and lawns.'
  const dress =
    o.kind === 'interior'
      ? 'Stage it like a luxury property brochure: refine the furniture into high-end designer pieces of the same size and place, and add tasteful styling such as a large rug, cushions and throws, framed art, indoor plants, table lamps, accessories on shelves and counters, and curtains where there are windows.'
      : 'Stage it like a luxury property brochure: lush manicured lawns, layered planting, palms and trees, flowering shrubs, garden and path lighting, outdoor furniture on patios and terraces, and premium cars in the porch if there is room.'
  const light =
    o.kind === 'interior'
      ? o.light === 'evening'
        ? 'Light it as an inviting evening: warm 2700 K interior lighting, glowing cove and pendant lights, soft shadows, a deep blue dusk outside the windows.'
        : 'Light it with bright, soft natural daylight through the windows balanced with warm accent lights, soft shadows, a pleasant view outside.'
      : o.light === 'evening'
        ? 'Light it at blue hour just after sunset: a glowing gradient sky, warm facade washers and uplights, lit windows, garden lights reflecting on the paving.'
        : 'Light it on a clear late afternoon: warm sun, a blue sky with soft clouds, natural shadows.'
  return [
    `Turn this 3D render into a magazine-quality, photorealistic architectural photograph of the ${o.area} of a ${o.style} house${where}, as shot by a professional interiors and architecture photographer with a full-frame camera.`,
    keep,
    dress,
    `True-to-life materials: natural stone and marble veining, real wood grain, fabric texture, glass reflections, brushed metal; accurate ambient occlusion and contact shadows.${finishes}`,
    light,
    'Do not add or remove rooms, walls, windows, doors, floors or storeys, and do not change the architecture. No people, no text, no logos, no watermarks.'
  ].join(' ')
}
