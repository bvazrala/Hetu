import { useBackendStatus, type BackendStatus as Status } from '../lib/connectivity'

const LABELS: Record<Status, string> = {
  checking: 'API: checking',
  retrying: 'API: connecting',
  up: 'API: connected',
  down: 'API: not reachable. Still retrying.',
}

export function BackendStatus() {
  return <span role="status">{LABELS[useBackendStatus()]}</span>
}
