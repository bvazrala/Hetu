// Finds the math inside a piece of text, so it can be typeset.

export interface Segment {
  /** True for math, false for ordinary words. */
  math: boolean
  /** The LaTeX source for math, or the words themselves. */
  value: string
  /** The original text, delimiters included. Shown if typesetting fails. */
  raw: string
  /** True for math that sits on its own line. */
  display: boolean
}

// Math marked with delimiters: \[ \], $$ $$, \( \), or $ $.
// A single dollar sign only opens math when no space follows it, so prices
// such as "$5 and $6" stay ordinary text.
const DELIMITED = /\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\$(?!\s)([^$\n]+?)(?<!\s)\$/g

// A LaTeX command written without delimiters, such as \sqrt{2k} or the
// spacing command \, as in "n\,(n+1)". Models sometimes forget the dollar
// signs, and this keeps the result readable.
const BARE_COMMAND = /\\[a-zA-Z]+(?:\{[^{}]*\})*|\\[,;:!]/g

function splitBareCommands(text: string): Segment[] {
  const segments: Segment[] = []
  let last = 0
  for (const match of text.matchAll(BARE_COMMAND)) {
    if (match.index > last) {
      const words = text.slice(last, match.index)
      segments.push({ math: false, value: words, raw: words, display: false })
    }
    segments.push({ math: true, value: match[0], raw: match[0], display: false })
    last = match.index + match[0].length
  }
  if (last < text.length) {
    const words = text.slice(last)
    segments.push({ math: false, value: words, raw: words, display: false })
  }
  return segments
}

export function splitMath(text: string): Segment[] {
  const segments: Segment[] = []
  let last = 0
  for (const match of text.matchAll(DELIMITED)) {
    if (match.index > last) segments.push(...splitBareCommands(text.slice(last, match.index)))
    const [raw, bracket, doubleDollar, paren, dollar] = match
    const display = bracket !== undefined || doubleDollar !== undefined
    segments.push({ math: true, value: bracket ?? doubleDollar ?? paren ?? dollar, raw, display })
    last = match.index + raw.length
  }
  if (last < text.length) segments.push(...splitBareCommands(text.slice(last)))
  return segments
}
