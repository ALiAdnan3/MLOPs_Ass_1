import OpenAI, { toFile } from 'openai'
import { imageEditParams, type AiImageRequest, type AiImageResponse, type ImageModelId, type ImageQuality } from '../shared/aiImage'

/**
 * AI PHOTOS (amendment A9): the app's render of an area goes to an OpenAI GPT Image model as the
 * image to edit, with a prompt that allows realism changes only. Runs in the main process so the
 * key never reaches the page.
 */
export async function runAiImage(apiKey: string | null, model: ImageModelId, quality: ImageQuality, req: AiImageRequest): Promise<AiImageResponse> {
  const key = apiKey ?? process.env.OPENAI_API_KEY ?? null
  if (!key) return { ok: false, error: 'No OpenAI API key is set. Add one in Settings, under AI photos.' }
  const client = new OpenAI({ apiKey: key, timeout: 300_000, maxRetries: 1 })
  try {
    const ext = req.mediaType === 'image/png' ? 'png' : 'jpg'
    const image = await toFile(Buffer.from(req.image), `render.${ext}`, { type: req.mediaType })
    const res = await client.images.edit({ image, prompt: req.prompt, ...imageEditParams(model, quality, req.size) })
    const b64 = res.data?.[0]?.b64_json
    if (!b64) return { ok: false, error: 'The image service returned no image. Try again.' }
    const buf = Buffer.from(b64, 'base64')
    return { ok: true, image: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, mediaType: 'image/jpeg', model }
  } catch (e) {
    return { ok: false, error: explain(e) }
  }
}

function explain(e: unknown): string {
  if (e instanceof OpenAI.APIError) {
    if (e.status === 401) return 'OpenAI did not accept the API key. Check it in Settings, under AI photos.'
    if (e.status === 403) return 'This OpenAI account cannot use the chosen image model. Your organisation may need verification, or pick another model in Settings.'
    if (e.status === 429) return 'OpenAI is rate-limiting this account, or its credit has run out. Wait a minute, or check billing.'
    if (e.status === 400) return `OpenAI could not use this request: ${e.message}`
    return `OpenAI returned an error (${e.status ?? 'network'}): ${e.message}`
  }
  const m = (e as Error)?.message ?? String(e)
  if (/certificate|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(m)) return `Could not reach OpenAI (${m}). Check the internet connection or proxy.`
  return m
}
