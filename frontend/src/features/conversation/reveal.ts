import { useEffect, useMemo, useState } from 'react'

/**
 * Places in a reply where it may be cut while it is being revealed: after a
 * space, and never inside math, code, a table, a graph, or bold text. A cut
 * anywhere else would flash broken formatting.
 */
export function safeCuts(text: string): number[] {
  const cuts: number[] = []
  let fence = false
  let inlineCode = false
  let displayMath = false
  let inlineMath = false
  let bold = false
  let lineStart = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStart = i + 1
    if (text.startsWith('```', i)) {
      fence = !fence
      i += 2
      continue
    }
    if (fence) continue
    if (text[i] === '`') inlineCode = !inlineCode
    else if (!inlineCode && text.startsWith('$$', i)) {
      displayMath = !displayMath
      i++
      continue
    } else if (!inlineCode && !displayMath && text[i] === '$') inlineMath = !inlineMath
    else if (!inlineCode && !inlineMath && text.startsWith('**', i)) {
      bold = !bold
      i++
      continue
    }
    const inTable = text[lineStart] === '|'
    if (/\s/.test(text[i]) && !inlineCode && !displayMath && !inlineMath && !bold && !inTable) cuts.push(i)
  }
  cuts.push(text.length)
  return cuts
}

const STEP_MS = 40
const MAX_MS = 3000
const MS_PER_CUT = 18

/** True where gradual reveal makes sense: a real browser without a reduced motion setting. */
function animationAllowed(): boolean {
  return typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Replies that have already been revealed, so a remount shows them whole. */
const played = new Set<string | number>()

/**
 * Reveals a reply a few words at a time. The whole reply has already
 * arrived, so this only paces the reading; it never takes more than a few
 * seconds. Returns the visible part and whether the reveal is finished.
 */
export function useReveal(id: string | number, text: string, active: boolean): { visible: string; done: boolean } {
  const cuts = useMemo(() => safeCuts(text), [text])
  const [animate] = useState(() => active && !played.has(id) && animationAllowed() && cuts.length > 1)
  const [step, setStep] = useState(animate ? 0 : cuts.length - 1)

  useEffect(() => {
    if (!animate) return
    played.add(id)
    const total = Math.min(MAX_MS, cuts.length * MS_PER_CUT)
    const steps = Math.max(1, Math.round(total / STEP_MS))
    let count = 0
    const timer = setInterval(() => {
      count += 1
      setStep(Math.min(cuts.length - 1, Math.round((count / steps) * (cuts.length - 1))))
      if (count >= steps) clearInterval(timer)
    }, STEP_MS)
    return () => clearInterval(timer)
  }, [animate, cuts, id])

  const index = Math.min(step, cuts.length - 1)
  return { visible: text.slice(0, cuts[index]), done: index >= cuts.length - 1 }
}
