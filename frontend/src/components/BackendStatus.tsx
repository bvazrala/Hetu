import { useBackendStatus, type BackendStatus as Status } from '../lib/connectivity'

// Nothing is shown while the server answers. A problem is worth a line; a healthy server is not.
const LABELS: Record<Status, string> = {
  checking: '',
  retrying: 'Connecting to Hetu…',
  up: '',
  down: 'Hetu cannot reach its server right now. It keeps trying.',
}

export function BackendStatus({ className }: { className?: string }) {
  const label = LABELS[useBackendStatus()]
  return (
    <p role="status" className={label ? className : 'sr-only'}>
      {label}
    </p>
  )
}
