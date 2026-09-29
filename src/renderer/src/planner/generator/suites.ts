import type { RoomType, Vec2 } from '../../core/model/types'
import { differencePolys, rectPoly, removeCollinear, area, type Rect } from '../../core/geometry/polygon'
import { spec, isBedroomType } from '../../core/constraints/rooms'
import type { ChildSpec } from './program'

/**
 * Split a suite slot into rooms:
 *  - bedrooms: bath (+ dressing) in a strip along one edge, leftover strip becomes a dressing area;
 *  - hubs, kitchens and others: attached rooms sit in a corner and the parent becomes L-shaped.
 * The parent keeps its access edge (where it meets circulation); baths prefer an exterior edge.
 */

export type Edge = 'left' | 'right' | 'front' | 'back'

export interface SuitePart {
  type: RoomType
  rect: Rect
  /** Non-rectangular outline (L-shaped parents). */
  poly?: Vec2[]
  isParent: boolean
}

export interface SplitContext {
  /** Contact length with circulation per edge. */
  access: Record<Edge, number>
  /** Edges on the building exterior (window-capable). */
  exterior: Record<Edge, boolean>
}

export function splitSuite(slot: Rect, parentType: RoomType, children: ChildSpec[], ctx: SplitContext): SuitePart[] {
  if (!children.length) return [{ type: parentType, rect: slot, isParent: true }]
  const minParent = spec(parentType).minWidth
  const stripThick = Math.max(...children.map((c) => Math.min(c.w, c.d)))
  const strip = isBedroomType(parentType)
  let best: { parts: SuitePart[]; score: number } | null = null
  for (const e of ['left', 'right', 'front', 'back'] as Edge[]) {
    const vertical = e === 'left' || e === 'right'
    const along = vertical ? slot.h : slot.w
    const across = vertical ? slot.w : slot.h
    const t = Math.min(stripThick, across - minParent * 0.75)
    if (t < 1.05) continue
    const kids = [...children].sort((a, b) => (a.type === 'bathroom' ? -1 : 0) - (b.type === 'bathroom' ? -1 : 0))
    const lens = kids.map((c) => Math.max(c.w, c.d, 1.2))
    const total = lens.reduce((s, x) => s + x, 0)
    for (const startAtEnd of [false, true]) {
      const parts: SuitePart[] = []
      const stripRect: Rect =
        e === 'left'
          ? { x: slot.x, y: slot.y, w: t, h: slot.h }
          : e === 'right'
            ? { x: slot.x + slot.w - t, y: slot.y, w: t, h: slot.h }
            : e === 'back'
              ? { x: slot.x, y: slot.y, w: slot.w, h: t }
              : { x: slot.x, y: slot.y + slot.h - t, w: slot.w, h: t }
      const kinds: RoomType[] = kids.map((k) => k.type)
      let segLens = lens.slice()
      let used = total
      if (strip) {
        if (total < along - 1.3 && kids.length === 1) {
          kinds.push(parentType === 'servant' ? 'store' : 'dressing')
          segLens.push(along - total)
          used = along
        }
        segLens = segLens.map((L) => (L * along) / used)
        used = along
      } else if (total > along) {
        segLens = segLens.map((L) => (L * along) / total)
        used = along
      }
      let pos = startAtEnd ? along - used : 0
      for (let i = 0; i < kinds.length; i++) {
        const L = segLens[i]
        const r: Rect = vertical ? { x: stripRect.x, y: stripRect.y + pos, w: stripRect.w, h: L } : { x: stripRect.x + pos, y: stripRect.y, w: L, h: stripRect.h }
        parts.push({ type: kinds[i], rect: r, isParent: false })
        pos += L
      }
      // parent: rectangle (full strip) or L-shape (corner block)
      let parent: SuitePart
      if (strip || Math.abs(used - along) < 1e-3) {
        const pr: Rect =
          e === 'left'
            ? { x: slot.x + t, y: slot.y, w: slot.w - t, h: slot.h }
            : e === 'right'
              ? { x: slot.x, y: slot.y, w: slot.w - t, h: slot.h }
              : e === 'back'
                ? { x: slot.x, y: slot.y + t, w: slot.w, h: slot.h - t }
                : { x: slot.x, y: slot.y, w: slot.w, h: slot.h - t }
        parent = { type: parentType, rect: pr, isParent: true }
      } else {
        const block: Rect = vertical
          ? { x: stripRect.x, y: stripRect.y + (startAtEnd ? along - used : 0), w: stripRect.w, h: used }
          : { x: stripRect.x + (startAtEnd ? along - used : 0), y: stripRect.y, w: used, h: stripRect.h }
        const diff = differencePolys(rectPoly(slot), rectPoly(block))
        if (diff.length !== 1) continue
        parent = { type: parentType, rect: slot, poly: removeCollinear(diff[0].outer), isParent: true }
      }
      parts.unshift(parent)

      // score
      let score = 0
      const pr = parent.rect
      const pShort = parent.poly ? Math.min(vertical ? slot.w - t : slot.w, vertical ? slot.h : slot.h - t) : Math.min(pr.w, pr.h)
      const pLong = Math.max(pr.w, pr.h)
      if (pShort < minParent) score -= (minParent - pShort) * 50
      if (!parent.poly && pLong / pShort > spec(parentType).maxAspect) score -= (pLong / pShort - spec(parentType).maxAspect) * 10
      // keep the parent's access edge
      const accessKept = (Object.keys(ctx.access) as Edge[]).filter((k) => k !== e).reduce((s, k) => s + ctx.access[k], 0) + (parent.poly ? ctx.access[e] * (1 - used / along) : 0)
      if (accessKept < 1.0) score -= 200
      score -= ctx.access[e] * (parent.poly ? 1 : 3)
      // children should reach the circulation or be reached from the parent: always via the parent
      if (ctx.exterior[e]) score += 12
      const parentExterior = (Object.keys(ctx.exterior) as Edge[]).some((k) => (k !== e || parent.poly) && ctx.exterior[k])
      if (!parentExterior && spec(parentType).habitable) score -= 25
      // prefer corner blocks towards an exterior corner
      if (parent.poly) {
        const endEdge: Edge = vertical ? (startAtEnd ? 'front' : 'back') : startAtEnd ? 'right' : 'left'
        if (ctx.exterior[endEdge]) score += 4
        if (ctx.access[endEdge] > 0.5) score -= 6
      }
      for (const p of parts.slice(1)) {
        const s = Math.min(p.rect.w, p.rect.h)
        const minW = spec(p.type).minWidth
        if (s < minW) score -= (minW - s) * 30
        const asp = Math.max(p.rect.w, p.rect.h) / Math.max(0.1, s)
        if (asp > 2.6) score -= (asp - 2.6) * 6
      }
      if (parent.poly && area(parent.poly) < spec(parentType).minArea) score -= 40
      if (!best || score > best.score) best = { parts, score }
    }
  }
  return best?.parts ?? [{ type: parentType, rect: slot, isParent: true }]
}
