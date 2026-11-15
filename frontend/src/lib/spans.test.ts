import { describe, expect, it } from 'vitest'
import { toStringRange } from './spans'

describe('toStringRange', () => {
  it('returns the same offsets for ordinary text', () => {
    const draft = 'Assume n² = 2k. Then n is even.'
    const range = toStringRange(draft, { start: 16, end: 31 })!
    expect(draft.slice(range.start, range.end)).toBe('Then n is even.')
  })

  it('adjusts for characters that take two UTF-16 units', () => {
    // Each 𝑛 is one code point and two UTF-16 units.
    const draft = 'Let 𝑛 be odd. Then 𝑛² is odd.'
    const codePoints = [...draft]
    const start = codePoints.join('').indexOf('Then') - 1 // one 𝑛 comes before it
    const range = toStringRange(draft, { start, end: codePoints.length })!
    expect(draft.slice(range.start, range.end)).toBe('Then 𝑛² is odd.')
  })

  it('returns null for a missing, empty, or out of range span', () => {
    expect(toStringRange('abc', null)).toBeNull()
    expect(toStringRange('abc', { start: 1, end: 1 })).toBeNull()
    expect(toStringRange('abc', { start: 2, end: 9 })).toBeNull()
  })
})
