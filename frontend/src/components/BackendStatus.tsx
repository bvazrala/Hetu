import { useEffect, useState } from 'react'
import { checkHealth } from '../lib/api'

type Status = 'checking' | 'waking' | 'up' | 'down'

const LABELS: Record<Status, string> = {
  checking: 'API: checking',
  waking: 'API: starting up. This can take a minute.',
  up: 'API: connected',
  down: 'API: not reachable. The example still shows a sample.',
}

// A free hosting instance sleeps when idle and needs about a minute to wake.
// Asking for /health on page load starts that wake-up early.
const ATTEMPTS = 15
const PAUSE_MS = 4000

/** Calls GET /health until it answers, and reports the state in plain text. */
export function BackendStatus() {
  const [status, setStatus] = useState<Status>('checking')

  useEffect(() => {
    let cancelled = false

    async function waitForBackend() {
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const ok = await checkHealth(5000)
        if (cancelled) return
        if (ok) {
          setStatus('up')
          return
        }
        setStatus('waking')
        await new Promise((resolve) => setTimeout(resolve, PAUSE_MS))
        if (cancelled) return
      }
      setStatus('down')
    }

    void waitForBackend()
    return () => {
      cancelled = true
    }
  }, [])

  return <span role="status">{LABELS[status]}</span>
}
