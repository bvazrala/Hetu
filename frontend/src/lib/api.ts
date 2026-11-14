// All backend calls go through this file.

import type { Analysis } from './types'

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

// These match the caps in backend/app/schemas.py.
export const MAX_PROBLEM_CHARS = 1000
export const MAX_DRAFT_CHARS = 4000

// A little longer than the backend's own limit, so its timeout answer arrives first.
const ANALYZE_TIMEOUT_MS = 70_000

/** Resolves to true when GET /health answers with status "ok". Never throws. */
export async function checkHealth(timeoutMs = 3000): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return false
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok'
  } catch {
    return false
  }
}

/** An analysis failure with a message that is safe to show to the student. */
export class AnalyzeError extends Error {}

const STATUS_MESSAGES: Record<number, string> = {
  422: 'The draft is empty or too long to analyze.',
  429: 'Too many requests. Wait a minute and try again.',
  503: 'Live analysis is not available right now.',
  504: 'The analysis took too long.',
}

/** Sends the problem and draft to POST /analyze. Throws AnalyzeError on any failure. */
export async function analyzeDraft(problem: string, draft: string): Promise<Analysis> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problem, draft }),
      signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    throw new AnalyzeError(timedOut ? 'The analysis took too long.' : 'The analysis server could not be reached.')
  }
  if (!response.ok) {
    throw new AnalyzeError(STATUS_MESSAGES[response.status] ?? 'The analysis could not be completed.')
  }
  return (await response.json()) as Analysis
}
