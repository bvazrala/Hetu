import { useEffect, useState } from 'react'
import { useMediaQuery } from './useMediaQuery'

/** The student's choice. "system" follows the device setting. */
export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'hetu.theme'
const ORDER: ThemeChoice[] = ['system', 'light', 'dark']
// Matches --color-paper in each theme, for the browser's own toolbar color.
const PAPER = { light: '#f7f4ec', dark: '#191b18' }

function readChoice(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

/** The theme choice, kept in this browser. It is a display preference, not student data. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice)
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const resolved = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PAPER[resolved])
  }, [resolved])

  function cycle() {
    const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]
    setChoice(next)
    try {
      if (next === 'system') window.localStorage.removeItem(KEY)
      else window.localStorage.setItem(KEY, next)
    } catch {
      // Storage can be blocked. The choice still holds for this visit.
    }
  }

  return { choice, resolved, cycle }
}
