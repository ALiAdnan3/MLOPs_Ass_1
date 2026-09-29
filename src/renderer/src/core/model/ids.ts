/** Stable, prefixed, collision-resistant IDs (§52). */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

let counter = 0

function randomChunk(len: number): string {
  let out = ''
  const bytes = new Uint8Array(len)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256)
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export function uid(prefix: string): string {
  counter = (counter + 1) % 1296
  return `${prefix}_${randomChunk(8)}${counter.toString(36).padStart(2, '0')}`
}

/** Deterministic id generator for seeded generation (designs must be reproducible). */
export function seededIds(seed: number) {
  let n = 0
  const base = Math.abs(Math.floor(seed)).toString(36)
  return (prefix: string) => `${prefix}_${base}${(n++).toString(36).padStart(3, '0')}`
}

export type IdFactory = (prefix: string) => string
