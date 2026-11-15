// Reads Hetu's replies aloud with the browser's own speech synthesis. One
// reply plays at a time: starting another stops the first. No audio is
// created or stored by Hetu.

import { useSyncExternalStore } from 'react'

export type PlaybackState = 'stopped' | 'playing' | 'paused'

interface Snapshot {
  /** The reply being read, or null. */
  id: string | null
  state: PlaybackState
}

let snapshot: Snapshot = { id: null, state: 'stopped' }
const listeners = new Set<() => void>()
// Each new playback gets a number, so events from a stopped one are ignored.
let generation = 0

function publish(next: Snapshot) {
  snapshot = next
  for (const listener of listeners) listener()
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

// Chrome stops long utterances partway through, so text is spoken in pieces
// of a sentence or a few.
const MAX_PIECE = 220

function pieces(text: string): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [text]
  const out: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if ((current + sentence).length > MAX_PIECE && current) {
      out.push(current.trim())
      current = ''
    }
    current += sentence
  }
  if (current.trim()) out.push(current.trim())
  return out
}

/** Reads `text` aloud as reply `id`, stopping anything else first. */
export function speak(id: string, text: string, rate = 1) {
  if (!speechSupported()) return
  window.speechSynthesis.cancel()
  const mine = ++generation
  const parts = pieces(text)
  if (parts.length === 0) return
  parts.forEach((part, index) => {
    const utterance = new SpeechSynthesisUtterance(part)
    utterance.rate = rate
    utterance.lang = document.documentElement.lang || 'en'
    if (index === parts.length - 1) {
      utterance.onend = () => mine === generation && publish({ id: null, state: 'stopped' })
    }
    utterance.onerror = () => mine === generation && publish({ id: null, state: 'stopped' })
    window.speechSynthesis.speak(utterance)
  })
  publish({ id, state: 'playing' })
}

export function pause() {
  if (snapshot.state !== 'playing') return
  window.speechSynthesis.pause()
  publish({ ...snapshot, state: 'paused' })
}

export function resume() {
  if (snapshot.state !== 'paused') return
  window.speechSynthesis.resume()
  publish({ ...snapshot, state: 'playing' })
}

export function stop() {
  generation++
  if (speechSupported()) window.speechSynthesis.cancel()
  publish({ id: null, state: 'stopped' })
}

export function usePlayback(): Snapshot {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot,
    () => snapshot,
  )
}

const SYMBOLS: [RegExp, string][] = [
  [/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1 over $2'],
  [/\\tfrac\{([^{}]*)\}\{([^{}]*)\}/g, '$1 over $2'],
  [/\\sqrt\{([^{}]*)\}/g, 'the square root of $1'],
  [/\^\{?2\}?/g, ' squared'],
  [/\^\{?3\}?/g, ' cubed'],
  [/\^\{([^{}]*)\}/g, ' to the power $1'],
  [/\^(\w)/g, ' to the power $1'],
  [/_\{([^{}]*)\}/g, ' $1'],
  [/\\(?:cdot|times)/g, ' times '],
  [/\\(?:le|leq)\b/g, ' is at most '],
  [/\\(?:ge|geq)\b/g, ' is at least '],
  [/\\neq?\b/g, ' is not equal to '],
  [/\\sum/g, ' the sum of '],
  [/\\pi/g, ' pi '],
  [/\\(?:mathrm|text|mathbf|mathit)\{([^{}]*)\}/g, '$1'],
  [/\\[,;:! ]/g, ' '],
  [/\\([a-zA-Z]+)/g, ' $1 '],
  [/=/g, ' equals '],
  [/[{}]/g, ''],
]

function mathToWords(math: string): string {
  return SYMBOLS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), math)
}

/**
 * Turns a Markdown reply into plain sentences for speaking: math becomes
 * words, code and plots are mentioned rather than read, and formatting marks
 * are dropped.
 */
export function toSpeech(markdown: string): string {
  return markdown
    .replace(/```plot[\s\S]*?```/g, ' A graph is shown on screen. ')
    .replace(/```[\s\S]*?```/g, ' A code example is shown on screen. ')
    .replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (_, a, b) => ` ${mathToWords(a ?? b)}. `)
    .replace(/\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g, (_, a, b) => mathToWords(a ?? b))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, '')
    .replace(/\|/g, ', ')
    .replace(/^#{1,6}\s+(.*)$/gm, '$1.')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~>]+/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}
