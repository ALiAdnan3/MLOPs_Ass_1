/**
 * Capture a canvas and encode it without blocking the page: createImageBitmap takes the frame (and
 * scales it down with high-quality filtering) on the GPU side, and a worker compresses it.
 * Falls back to a 2D canvas and toBlob where workers or OffscreenCanvas are missing.
 */
let worker: Worker | null = null
let failed = false
let nextId = 1
const waiting = new Map<number, { resolve: (b: Blob) => void; reject: (e: unknown) => void }>()

function encoder(): Worker | null {
  if (worker || failed) return worker
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    failed = true
    return null
  }
  try {
    worker = new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id)
      if (!w) return
      waiting.delete(e.data.id)
      if (e.data.error) w.reject(new Error(e.data.error))
      else w.resolve(e.data.blob)
    }
    worker.onerror = () => {
      failed = true
      for (const w of waiting.values()) w.reject(new Error('encoder failed'))
      waiting.clear()
      worker = null
    }
  } catch {
    failed = true
  }
  return worker
}

/**
 * Take the canvas's current frame now (call it right after drawing) and resolve with the encoded
 * image at `width` × `height`.
 */
export function captureCanvas(canvas: HTMLCanvasElement, width: number, height: number, type: 'image/png' | 'image/jpeg', quality: number, crop?: { x: number; y: number; width: number; height: number }): Promise<Blob> {
  const r = crop ?? { x: 0, y: 0, width: canvas.width, height: canvas.height }
  const w = encoder()
  if (w) {
    // the frame is taken at this call, before the caller restores the canvas
    const shot = createImageBitmap(canvas, r.x, r.y, r.width, r.height, width === r.width && height === r.height ? {} : { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
    return shot.then(
      (bitmap) =>
        new Promise<Blob>((resolve, reject) => {
          const id = nextId++
          waiting.set(id, { resolve, reject })
          w.postMessage({ id, bitmap, type, quality }, [bitmap])
        })
    )
  }
  let source = canvas
  if (crop || width !== canvas.width || height !== canvas.height) {
    source = document.createElement('canvas')
    source.width = width
    source.height = height
    const g = source.getContext('2d')!
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.drawImage(canvas, r.x, r.y, r.width, r.height, 0, 0, width, height)
  }
  return new Promise<Blob>((resolve, reject) => source.toBlob((b) => (b ? resolve(b) : reject(new Error('capture failed'))), type, quality))
}
