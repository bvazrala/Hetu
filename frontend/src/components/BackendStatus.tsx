import { useEffect, useState } from 'react'
import { checkHealth } from '../lib/api'

type Status = 'checking' | 'up' | 'down'

const LABELS: Record<Status, string> = {
  checking: 'API: checking',
  up: 'API: connected',
  down: 'API: not reachable. The example still works.',
}

/** Calls GET /health once on load and reports the result in plain text. */
export function BackendStatus() {
  const [status, setStatus] = useState<Status>('checking')

  useEffect(() => {
    let cancelled = false
    void checkHealth().then((ok) => {
      if (!cancelled) setStatus(ok ? 'up' : 'down')
    })
    return () => {
      cancelled = true
    }
  }, [])

  return <span role="status">{LABELS[status]}</span>
}
