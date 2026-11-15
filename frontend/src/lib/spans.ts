import type { Span } from './types'

export interface StringRange {
  start: number
  end: number
}

/**
 * Converts a span from the API into indices for a JavaScript string.
 *
 * The API counts code points and JavaScript counts UTF-16 units. They differ
 * once the draft contains a character such as 𝑛 or an emoji, and using one
 * for the other would highlight the wrong text. Returns null when the span
 * is missing or does not fit inside the draft.
 */
export function toStringRange(draft: string, span: Span | null | undefined): StringRange | null {
  if (!span || span.start < 0 || span.end <= span.start) return null

  let codePoints = 0
  let index = 0
  let start = -1
  for (const character of draft) {
    if (codePoints === span.start) start = index
    codePoints += 1
    index += character.length
    if (codePoints === span.end) return start >= 0 ? { start, end: index } : null
  }
  return null
}
