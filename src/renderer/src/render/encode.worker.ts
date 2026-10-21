/// <reference lib="webworker" />

/**
 * Encodes captured frames (ImageBitmaps) to JPEG / PNG off the main thread. Reading the pixels back
 * from the GPU and compressing them used to block the page for ~100 ms per picture.
 */
export interface EncodeJob {
  id: number
  bitmap: ImageBitmap
  type: 'image/png' | 'image/jpeg'
  quality: number
}

self.onmessage = async (e: MessageEvent<EncodeJob>) => {
  const { id, bitmap, type, quality } = e.data
  try {
    const c = new OffscreenCanvas(bitmap.width, bitmap.height)
    c.getContext('2d')!.drawImage(bitmap, 0, 0)
    bitmap.close()
    const blob = await c.convertToBlob({ type, quality })
    ;(self as unknown as Worker).postMessage({ id, blob })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
