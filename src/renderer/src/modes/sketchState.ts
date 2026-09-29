import { create } from 'zustand'
import type { RoomType, Vec2 } from '../core/model/types'
import type { InkStroke, RecognizedPlan, TextMark } from '../ai/sketchRecognizer'
import { recognize, vectorizeStrokes, segmentsFromImage } from '../ai/sketchRecognizer'
import type { Seg } from '../core/geometry/planar'

/** Sketch mode state shared by the drawing surface and its side panel (§19, §20). */

export type SketchTool = 'pen' | 'eraser' | 'text' | 'pan'

export interface SketchImage {
  url: string
  w: number
  h: number
  /** World placement: top-left and metres per pixel. */
  x: number
  y: number
  mpp: number
  data: ImageData
}

interface SketchState {
  tool: SketchTool
  strokes: InkStroke[]
  texts: TextMark[]
  redo: (InkStroke | TextMark)[]
  image: SketchImage | null
  result: RecognizedPlan | null
  /** Room ids the user has confirmed (answered "yes" or picked a type). */
  confirmed: string[]
  gridM: number
  focusRoom: string | null
  set: (p: Partial<SketchState>) => void
  addStroke: (s: InkStroke) => void
  addText: (t: TextMark) => void
  undo: () => void
  clear: () => void
  setRoomType: (id: string, type: RoomType, name: string) => void
}

export const useSketch = create<SketchState>((set, get) => ({
  tool: 'pen',
  strokes: [],
  texts: [],
  redo: [],
  image: null,
  result: null,
  confirmed: [],
  gridM: 0.3048,
  focusRoom: null,
  set: (p) => set(p),
  addStroke: (s) => set({ strokes: [...get().strokes, s], redo: [], result: null }),
  addText: (t) => set({ texts: [...get().texts, t], redo: [], result: null }),
  undo: () => {
    const { strokes, texts } = get()
    // undo whichever mark was added last (texts carry no timestamps; strokes first is fine)
    if (strokes.length) set({ strokes: strokes.slice(0, -1), redo: [...get().redo, strokes[strokes.length - 1]], result: null })
    else if (texts.length) set({ texts: texts.slice(0, -1), redo: [...get().redo, texts[texts.length - 1]], result: null })
  },
  clear: () => set({ strokes: [], texts: [], redo: [], result: null, image: null, confirmed: [] }),
  setRoomType: (id, type, name) => {
    const r = get().result
    if (!r) return
    set({
      result: { ...r, rooms: r.rooms.map((x) => (x.id === id ? { ...x, type, name, confidence: 1, reason: 'confirmed by you' } : x)) },
      confirmed: [...get().confirmed, id]
    })
  }
}))

/** Run recognition on the current ink (and imported sketch image, if any). */
export function runRecognition(): RecognizedPlan {
  const st = useSketch.getState()
  const { segs, arcs } = vectorizeStrokes(st.strokes)
  const all: Seg[] = [...segs]
  let thin: Seg[] = []
  if (st.image) {
    const im = segmentsFromImage(st.image.data)
    const T = (p: Vec2): Vec2 => ({ x: st.image!.x + p.x * st.image!.mpp, y: st.image!.y + p.y * st.image!.mpp })
    all.push(...im.segs.map((s) => ({ a: T(s.a), b: T(s.b) })))
    thin = im.thin.map((s) => ({ a: T(s.a), b: T(s.b) }))
  }
  const result = recognize(all, { tol: st.image ? Math.max(0.2, st.image.mpp * 8) : 0.35, arcs, texts: st.texts, windowMarks: thin.filter((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 0.5) })
  st.set({ result, confirmed: [] })
  return result
}
