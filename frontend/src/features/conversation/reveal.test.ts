import { describe, expect, it } from 'vitest'
import { safeCuts } from './reveal'

function pieces(text: string): string[] {
  return safeCuts(text).map((cut) => text.slice(0, cut))
}

describe('safeCuts', () => {
  it('cuts between words and ends with the whole text', () => {
    const text = 'one two three'
    expect(pieces(text)).toEqual(['one', 'one two', 'one two three'])
  })

  it('never cuts inside inline or display math', () => {
    const text = 'Let $a + b = c$ hold and $$x^2 + y^2 = z^2$$ follows.'
    for (const piece of pieces(text)) {
      expect((piece.match(/\$/g) ?? []).length % 2).toBe(0)
    }
  })

  it('never cuts inside a code fence or inline code', () => {
    const text = 'Here:\n```plot\n{ "functions": [ { "expr": "x ^ 2" } ] }\n```\nand `a b c` too.'
    for (const piece of pieces(text)) {
      expect((piece.match(/```/g) ?? []).length % 2).toBe(0)
      expect((piece.replace(/```/g, '').match(/`/g) ?? []).length % 2).toBe(0)
    }
  })

  it('never cuts inside bold text', () => {
    const text = 'This is **very important indeed** to see.'
    for (const piece of pieces(text)) {
      expect((piece.match(/\*\*/g) ?? []).length % 2).toBe(0)
    }
  })

  it('never cuts inside a table line', () => {
    const text = 'Table:\n| a | b |\n| - | - |\n| 1 | 2 |\nDone now.'
    for (const piece of pieces(text)) {
      const lastLine = piece.slice(piece.lastIndexOf('\n') + 1)
      expect(lastLine.startsWith('|') && !lastLine.endsWith('|')).toBe(false)
    }
  })
})
