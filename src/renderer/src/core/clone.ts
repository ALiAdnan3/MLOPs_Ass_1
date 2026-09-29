import { current, isDraft } from 'immer'

/** Deep copy that also works on Immer drafts (structuredClone cannot clone a draft proxy). */
export function deepClone<T>(x: T): T {
  return structuredClone(isDraft(x) ? (current(x as never) as T) : x)
}
