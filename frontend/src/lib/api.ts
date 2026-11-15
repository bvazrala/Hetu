// All backend calls go through this file.

import type { Analysis, Challenge, ChatRequest, ChatResponse } from './types'

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

// These match the caps in backend/app/schemas.py.
export const MAX_PROBLEM_CHARS = 1000
export const MAX_DRAFT_CHARS = 4000
export const MAX_CHALLENGE_CHARS = 600
export const MAX_MESSAGE_CHARS = 6000
export const MAX_MESSAGES = 24

// A little longer than the backend's own limit, so its timeout answer arrives first.
const REQUEST_TIMEOUT_MS = 70_000

// Every request tells the status monitor whether the server answered, so
// the status line reflects real traffic and not only its own health checks.
type ReachabilityListener = (reachable: boolean) => void
const reachabilityListeners = new Set<ReachabilityListener>()

export function onReachability(listener: ReachabilityListener): () => void {
  reachabilityListeners.add(listener)
  return () => reachabilityListeners.delete(listener)
}

function reportReachability(reachable: boolean): void {
  for (const listener of reachabilityListeners) listener(reachable)
}

/** Resolves to true when GET /health answers with status "ok". Never throws. */
export async function checkHealth(timeoutMs = 5000): Promise<boolean> {
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

/** A request failure with a message that is safe to show to the student. */
export class AnalyzeError extends Error {}

const STATUS_MESSAGES: Record<number, string> = {
  422: 'The text is empty or too long to analyze.',
  429: 'Too many requests. Wait a minute and try again.',
  503: 'Live analysis is not available right now.',
  504: 'The analysis took too long.',
}

const CHAT_STATUS_MESSAGES: Record<number, string> = {
  422: 'That message is too long to send.',
  429: 'Too many requests. Wait a minute and try again.',
  503: 'Hetu is not available right now.',
  504: 'Hetu took too long to answer.',
}

/** Supplies a signed-in user's token, so their requests count against their own account. */
let tokenProvider: () => Promise<string | null> = async () => null

export function setTokenProvider(provider: () => Promise<string | null>) {
  tokenProvider = provider
}

async function post(path: string, body: unknown, failures: Record<number, string>, fallback: string): Promise<unknown> {
  let response: Response
  const token = await tokenProvider().catch(() => null)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    // A slow answer says nothing about whether the server is reachable.
    if (!timedOut) reportReachability(false)
    throw new AnalyzeError(timedOut ? failures[504] : 'The server could not be reached.')
  }
  // Any HTTP answer, including an error status, means the server is there.
  reportReachability(true)
  if (response.status === 429) {
    // The server says which limit was reached: per minute, per day, or overall.
    const detail = await response
      .json()
      .then((body: unknown) => (body as { detail?: unknown }).detail)
      .catch(() => null)
    throw new AnalyzeError(typeof detail === 'string' ? detail : failures[429])
  }
  if (!response.ok) throw new AnalyzeError(failures[response.status] ?? fallback)
  return response.json()
}

/** Sends one turn of the conversation to POST /chat. Throws AnalyzeError on any failure. */
export async function sendChat(request: ChatRequest): Promise<ChatResponse> {
  return (await post('/chat', request, CHAT_STATUS_MESSAGES, 'Hetu could not answer.')) as ChatResponse
}

/**
 * Sends the problem and draft to POST /analyze. With a challenge, the server
 * reconsiders one earlier question. Throws AnalyzeError on any failure.
 */
export async function analyzeDraft(problem: string, draft: string, challenge?: Challenge): Promise<Analysis> {
  const body = challenge ? { problem, draft, challenge } : { problem, draft }
  return (await post('/analyze', body, STATUS_MESSAGES, 'The analysis could not be completed.')) as Analysis
}
