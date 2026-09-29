import Anthropic from '@anthropic-ai/sdk'
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema'
import type { AiRequest, AiResponse } from '../shared/api'
import { EDIT_SYSTEM, REQUIREMENTS_SYSTEM, editSchema, requirementsSchema } from '../shared/ai-schemas'

/**
 * Optional Claude integration (runs in the main process so the API key never reaches the page).
 * Uses structured outputs so every reply is schema-valid JSON, with the server-side refusal
 * fallback enabled. The app is fully usable offline without this.
 */

const MODEL = 'claude-opus-5-5'

export async function runAi(apiKey: string | null, req: AiRequest): Promise<AiResponse> {
  if (!apiKey && !process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'No Claude API key is set. Add one in Settings, or keep using the built-in offline assistant.' }
  const client = apiKey ? new Anthropic({ apiKey, timeout: 90_000, maxRetries: 2 }) : new Anthropic({ timeout: 90_000, maxRetries: 2 })
  const isReq = req.task === 'requirements'
  const system = isReq ? REQUIREMENTS_SYSTEM : EDIT_SYSTEM
  const content = isReq ? req.text : `Current house model:\n${req.context ?? '{}'}\n\nInstruction: ${req.text}`
  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      output_config: {
        effort: 'low',
        format: betaJSONSchemaOutputFormat(isReq ? requirementsSchema : editSchema)
      },
      messages: [{ role: 'user', content }]
    })
    if (response.stop_reason === 'refusal') {
      return { ok: false, refused: true, error: 'Claude declined this request. The offline assistant will handle it instead.', model: response.model }
    }
    if (response.stop_reason === 'max_tokens') return { ok: false, error: 'The reply was cut off. Try a shorter instruction.' }
    if (!response.parsed_output) return { ok: false, error: 'Claude returned an unreadable answer.' }
    return { ok: true, data: response.parsed_output, model: response.model }
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, error: 'The Claude API key was rejected. Check it in Settings.' }
    if (error instanceof Anthropic.RateLimitError) return { ok: false, error: 'Claude is rate-limited right now. Try again in a minute.' }
    if (error instanceof Anthropic.BadRequestError) return { ok: false, error: `Claude could not process the request: ${error.message}` }
    if (error instanceof Anthropic.APIConnectionError) return { ok: false, error: 'No connection to Claude. You are offline — the built-in assistant still works.' }
    if (error instanceof Anthropic.APIError) return { ok: false, error: `Claude API error ${error.status}: ${error.message}` }
    return { ok: false, error: String((error as Error)?.message ?? error) }
  }
}
