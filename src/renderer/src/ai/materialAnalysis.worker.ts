/// <reference lib="webworker" />
import { analyzeImage, generateMaps } from './materialAnalysis'

self.onmessage = async (e: MessageEvent<{ id: number; bitmap: ImageBitmap; seamless: boolean }>) => {
  const { id, bitmap, seamless } = e.data
  try {
    // analysis on a 256 px copy, maps at up to 1024 px (square)
    const small = new OffscreenCanvas(256, 256)
    const sc = small.getContext('2d')!
    sc.drawImage(bitmap, 0, 0, 256, 256)
    const a = analyzeImage({ data: sc.getImageData(0, 0, 256, 256).data, w: 256, h: 256 })
    const n = Math.min(1024, Math.max(256, 2 ** Math.round(Math.log2(Math.min(bitmap.width, bitmap.height)))))
    const big = new OffscreenCanvas(n, n)
    const bc = big.getContext('2d')!
    const side = Math.min(bitmap.width, bitmap.height)
    bc.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, n, n)
    const maps = generateMaps(bc.getImageData(0, 0, n, n).data, n, a, seamless)
    const toBlob = async (px: Uint8ClampedArray, type = 'image/png') => {
      const c = new OffscreenCanvas(n, n)
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px), n, n), 0, 0)
      return c.convertToBlob({ type, quality: 0.92 })
    }
    const [base, normal, rough, height] = await Promise.all([toBlob(maps.base, 'image/jpeg'), toBlob(maps.normal), toBlob(maps.rough), toBlob(maps.height)])
    ;(self as unknown as Worker).postMessage({ id, analysis: a, base, normal, rough, height })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
