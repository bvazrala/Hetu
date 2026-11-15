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

// Splits text into code and everything else, so math delimiters inside code are left alone.
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/

/**
 * Prepares model-written math for the Markdown math plugin.
 *
 * Models write math as $...$, $$...$$, \(...\), or \[...\]. The plugin reads
 * only the dollar forms, and it treats $$...$$ as a displayed equation only
 * when the dollar signs sit on their own lines. Both are adjusted here.
 *
 * A table row must stay on one line, so a displayed equation inside one is
 * made inline instead. Otherwise the rest of the table falls apart.
 */
export function normalizeMath(text: string): string {
  // One pass for both display forms, so an equation is never wrapped twice.
  const display = (_: string, bracket?: string, dollars?: string) =>
    `\n\n$$\n${(bracket ?? dollars ?? '').trim()}\n$$\n\n`
  const inline = (_: string, bracket?: string, dollars?: string) => `$${(bracket ?? dollars ?? '').trim()}$`
  const inTableRows = (part: string) =>
    part
      .split('\n')
      .map((line) => (line.trimStart().startsWith('|') ? line.replace(/\\\[(.+?)\\\]|\$\$(.+?)\$\$/g, inline) : line))
      .join('\n')
  return text
    .split(CODE)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : inTableRows(part)
            .replace(/\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$/g, display)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, math: string) => `$${math}$`),
    )
    .join('')
}
