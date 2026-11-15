// Keeps the problem and draft in this browser so a refresh does not lose
// work. Storage can be missing, full, or blocked, and saved data can be
// damaged, so every function here fails quietly.

import { MAX_DRAFT_CHARS, MAX_PROBLEM_CHARS } from './api'

const KEY = 'hetu.workspace.v1'

export interface SavedWorkspace {
  problem: string
  draft: string
}

/** Returns the saved work, or null if there is none or it cannot be trusted. */
export function loadWorkspace(): SavedWorkspace | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { problem, draft } = value as Record<string, unknown>
    if (typeof problem !== 'string' || typeof draft !== 'string') return null
    // Trimming to the input caps keeps a damaged entry from blocking the fields.
    return { problem: problem.slice(0, MAX_PROBLEM_CHARS), draft: draft.slice(0, MAX_DRAFT_CHARS) }
  } catch {
    return null
  }
}

/** Saves the work. Returns false when the browser would not store it. */
export function saveWorkspace(workspace: SavedWorkspace): boolean {
  try {
    if (workspace.problem === '' && workspace.draft === '') {
      window.localStorage.removeItem(KEY)
    } else {
      window.localStorage.setItem(KEY, JSON.stringify(workspace))
    }
    return true
  } catch {
    return false
  }
}

export function clearWorkspace(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing was stored, so there is nothing to clear.
  }
}
