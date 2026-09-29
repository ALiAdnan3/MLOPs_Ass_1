import { jsPDF } from 'jspdf'
import type { Project } from '../core/model/types'
import type { ExportFile } from '../../../shared/api'
import { A3, drawDrawing, drawSheet, type DrawingSpec } from './sheets'
import { DxfContext, PdfContext, TransformContext } from './contexts'
import { SvgContext } from '../render/draw/svg'
import { CanvasContext } from '../render/draw/canvas'

export type DrawingFormat = 'pdf' | 'svg' | 'png' | 'jpg' | 'dxf'

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'house'

const yieldFrame = () => new Promise((r) => setTimeout(r, 0))

/** Export a set of drawings. PDF = one multi-page A3 set; SVG/PNG/JPG = one sheet each; DXF = model space in metres. */
export async function exportDrawings(p: Project, specs: DrawingSpec[], format: DrawingFormat, o: { color?: boolean; dpi?: number; onProgress?: (i: number, n: number) => void } = {}): Promise<ExportFile[]> {
  const slug = slugify(p.name)
  const files: ExportFile[] = []
  if (format === 'pdf') {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true })
    doc.setProperties({ title: `${p.name} drawings`, subject: 'Conceptual house design drawings', creator: 'HomeForge AI', keywords: 'conceptual, preliminary' })
    for (let i = 0; i < specs.length; i++) {
      if (i) doc.addPage('a3', 'landscape')
      drawSheet(new PdfContext(doc), p, specs[i], i, specs.length, { color: o.color })
      o.onProgress?.(i + 1, specs.length)
      await yieldFrame()
    }
    files.push({ name: `${slug}-drawings.pdf`, data: doc.output('arraybuffer') })
    return files
  }
  for (let i = 0; i < specs.length; i++) {
    const d = specs[i]
    const base = `${slug}-${d.number.toLowerCase()}-${slugify(d.title)}`
    if (format === 'svg') {
      const svg = new SvgContext(96 / 25.4, 0.3528)
      drawSheet(svg, p, d, i, specs.length, { color: o.color })
      files.push({ name: `${base}.svg`, data: svg.toString({ x: 0, y: 0, w: A3.w, h: A3.h }, '#ffffff', Math.round((A3.w / 25.4) * 96)) })
    } else if (format === 'dxf') {
      const dxf = new DxfContext()
      drawDrawing(dxf, p, d, { color: false })
      files.push({ name: `${base}.dxf`, data: dxf.toString() })
    } else {
      const dpi = o.dpi ?? 200
      const pxPerMm = dpi / 25.4
      const c = document.createElement('canvas')
      c.width = Math.round(A3.w * pxPerMm)
      c.height = Math.round(A3.h * pxPerMm)
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, c.width, c.height)
      const cc = new CanvasContext(ctx, { scale: pxPerMm, ox: 0, oy: 0 }, 1)
      // line weights in points → device pixels at this resolution
      drawSheet(new TransformContext(cc, 1, 0, 0, 0.3528 * pxPerMm), p, d, i, specs.length, { color: o.color })
      const type = format === 'png' ? 'image/png' : 'image/jpeg'
      const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('The sheet image could not be encoded.'))), type, 0.92))
      files.push({ name: `${base}.${format}`, data: await blob.arrayBuffer() })
    }
    o.onProgress?.(i + 1, specs.length)
    await yieldFrame()
  }
  return files
}

/** One sheet as an SVG string (used for on-screen previews of any drawing). */
export function sheetSvg(p: Project, d: DrawingSpec, color = true): string {
  const svg = new SvgContext(96 / 25.4, 0.3528)
  drawSheet(svg, p, d, 0, 1, { color })
  return svg.toString({ x: 0, y: 0, w: A3.w, h: A3.h }, '#ffffff')
}

/** A bare drawing (no sheet) as an SVG string, fitted to its own extent. */
export function drawingSvg(p: Project, d: DrawingSpec, color = true, widthPx = 900): string {
  const probe = new SvgContext(100, 0.03)
  const ext = drawDrawing(probe, p, d, { color })
  const svg = new SvgContext(widthPx / ext.w, 0.035)
  drawDrawing(svg, p, d, { color })
  return svg.toString(ext, '#ffffff', widthPx)
}
