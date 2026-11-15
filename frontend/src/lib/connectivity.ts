// Tracks whether the backend can be reached, and keeps checking.
//
// An earlier version stopped checking after about a minute, so a page opened
// while the server was restarting showed "not reachable" for good, even
// after analyses were succeeding. This monitor never stops: it retries
// quickly at first, then slowly, and rechecks a healthy server now and then.

import { useEffect, useSyncExternalStore } from 'react'
import { checkHealth, onReachability } from './api'

export type BackendStatus = 'checking' | 'retrying' | 'up' | 'down'

const RETRY_FAST_MS = 5_000
const RETRY_SLOW_MS = 20_000
const RECHECK_MS = 60_000
// Failed checks before "retrying" becomes "down". About one minute.
const FAST_ATTEMPTS = 12

let status: BackendStatus = 'checking'
let failures = 0
let timer: ReturnType<typeof setTimeout> | undefined
let watchers = 0
const listeners = new Set<() => void>()

function publish(next: BackendStatus): void {
  if (next === status) return
  status = next
  for (const listener of listeners) listener()
}

function schedule(): void {
  clearTimeout(timer)
  if (watchers === 0) return
  const delay = status === 'up' ? RECHECK_MS : status === 'down' ? RETRY_SLOW_MS : RETRY_FAST_MS
  timer = setTimeout(() => void check(), delay)
}

function record(reachable: boolean): void {
  if (reachable) {
    failures = 0
    publish('up')
  } else {
    failures += 1
    publish(failures > FAST_ATTEMPTS ? 'down' : 'retrying')
  }
  schedule()
}

async function check(): Promise<void> {
  clearTimeout(timer)
  record(await checkHealth())
}

function checkWhenVisible(): void {
  if (document.visibilityState === 'visible') void check()
}

function checkNow(): void {
  void check()
}

onReachability(record)

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The current backend status. Monitoring runs while any component uses this hook. */
export function useBackendStatus(): BackendStatus {
  const current = useSyncExternalStore(subscribe, () => status)

  useEffect(() => {
    watchers += 1
    if (watchers === 1) {
      void check()
      // Coming back online or back to the tab is a good moment to look again.
      window.addEventListener('online', checkNow)
      document.addEventListener('visibilitychange', checkWhenVisible)
    }
    return () => {
      watchers -= 1
      if (watchers === 0) {
        clearTimeout(timer)
        window.removeEventListener('online', checkNow)
        document.removeEventListener('visibilitychange', checkWhenVisible)
      }
    }
  }, [])

  return current
}
