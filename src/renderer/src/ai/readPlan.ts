import { platform } from '../storage/platform'
import type { ReadPlanResult } from '../../../shared/ai-schemas'
import type { TextMark } from './sketchRecognizer'
import type { Vec2 } from '../core/model/types'

/**
 * Optional Claude vision (amendment A5): reads the hand-written room names and dimensions on a
 * sketch or plan photo. Only runs when the user has a Claude key and ticks the option; the image
 * goes to Claude, nothing else. Offline recognition works without it.
 */

export async function claudeVisionAvailable(): Promise<boolean> {
  if (platform.platform === 'web') return false
  try {
    return (await platform.settings.get()).hasApiKey
  } catch {
    return false
  }
}

export async function readPlanWithClaude(dataUrl: string): Promise<{ ok: true; result: ReadPlanResult } | { ok: false; error: string }> {
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/)
  if (!m) return { ok: false, error: 'The image could not be prepared for Claude.' }
  const r = await platform.ai({ task: 'readPlan', text: '', image: { mediaType: m[1] as 'image/jpeg' | 'image/png', data: m[2] } })
  if (!r.ok || !r.data) return { ok: false, error: r.error ?? 'Claude could not read the drawing.' }
  return { ok: true, result: r.data as ReadPlanResult }
}

/** Labels for the recognizer, placed with `toPlan` (image fractions → the recognizer's units). */
export function textsFromReading(r: ReadPlanResult, toPlan: (fx: number, fy: number) => Vec2): TextMark[] {
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  return [
    ...r.rooms.filter((x) => x.name.trim()).map((x) => ({ p: toPlan(clamp(x.x), clamp(x.y)), text: x.name })),
    ...r.dimensions.filter((d) => d.widthFt > 0 && d.lengthFt > 0).map((d) => ({ p: toPlan(clamp(d.x), clamp(d.y)), text: `${+d.widthFt.toFixed(2)}' x ${+d.lengthFt.toFixed(2)}'` }))
  ]
}

/**
 * Render a sketch (strokes over an optional photo) to a JPEG and the mapping back to plan metres,
 * so hand-written words on it can be read.
 */
export async function sketchSnapshot(
  strokes: { pts: Vec2[] }[],
  image: { url: string; w: number; h: number; x: number; y: number; mpp: number } | null
): Promise<{ dataUrl: string; toPlan: (fx: number, fy: number) => Vec2 } | null> {
  const pts = strokes.flatMap((s) => s.pts)
  if (image) pts.push({ x: image.x, y: image.y }, { x: image.x + image.w * image.mpp, y: image.y + image.h * image.mpp })
  if (!pts.length) return null
  let x0 = Math.min(...pts.map((p) => p.x))
  let y0 = Math.min(...pts.map((p) => p.y))
  let x1 = Math.max(...pts.map((p) => p.x))
  let y1 = Math.max(...pts.map((p) => p.y))
  const pad = Math.max(0.5, (x1 - x0) * 0.04)
  x0 -= pad
  y0 -= pad
  x1 += pad
  y1 += pad
  const k = 1400 / Math.max(x1 - x0, y1 - y0)
  const c = document.createElement('canvas')
  c.width = Math.max(64, Math.round((x1 - x0) * k))
  c.height = Math.max(64, Math.round((y1 - y0) * k))
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  if (image) {
    const el = new Image()
    el.src = image.url
    await el.decode().catch(() => undefined)
    g.drawImage(el, (image.x - x0) * k, (image.y - y0) * k, image.w * image.mpp * k, image.h * image.mpp * k)
  }
  g.strokeStyle = '#111'
  g.lineWidth = 3
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const s of strokes) {
    g.beginPath()
    s.pts.forEach((p, i) => (i ? g.lineTo((p.x - x0) * k, (p.y - y0) * k) : g.moveTo((p.x - x0) * k, (p.y - y0) * k)))
    g.stroke()
  }
  return { dataUrl: c.toDataURL('image/jpeg', 0.9), toPlan: (fx, fy) => ({ x: x0 + fx * (x1 - x0), y: y0 + fy * (y1 - y0) }) }
}
