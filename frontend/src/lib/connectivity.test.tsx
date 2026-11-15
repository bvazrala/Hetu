import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The monitor keeps its state at module level, so each test loads a fresh copy.
async function loadMonitor(checkHealth: () => Promise<boolean>) {
  vi.resetModules()
  let notify: (reachable: boolean) => void = () => {}
  vi.doMock('./api', () => ({
    checkHealth,
    onReachability: (listener: (reachable: boolean) => void) => {
      notify = listener
      return () => {}
    },
  }))
  const { BackendStatus } = await import('../components/BackendStatus')
  return { BackendStatus, notify: (reachable: boolean) => act(() => notify(reachable)) }
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

describe('backend status', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reports a healthy server', async () => {
    const { BackendStatus } = await loadMonitor(async () => true)
    render(<BackendStatus />)
    await advance(0)
    expect(screen.getByRole('status')).toHaveTextContent('API: connected')
  })

  it('recovers after a long outage instead of giving up', async () => {
    let healthy = false
    const { BackendStatus } = await loadMonitor(async () => healthy)
    render(<BackendStatus />)

    await advance(0)
    expect(screen.getByRole('status')).toHaveTextContent('API: connecting')

    // Well past the point where the old monitor stopped checking.
    await advance(5 * 60_000)
    expect(screen.getByRole('status')).toHaveTextContent('API: not reachable')

    healthy = true
    await advance(20_000)
    expect(screen.getByRole('status')).toHaveTextContent('API: connected')
  })

  it('notices when a healthy server goes away', async () => {
    let healthy = true
    const { BackendStatus } = await loadMonitor(async () => healthy)
    render(<BackendStatus />)
    await advance(0)

    healthy = false
    await advance(60_000)
    expect(screen.getByRole('status')).toHaveTextContent('API: connecting')
  })

  it('follows real requests, not only its own checks', async () => {
    const { BackendStatus, notify } = await loadMonitor(async () => false)
    render(<BackendStatus />)
    await advance(0)
    expect(screen.getByRole('status')).toHaveTextContent('API: connecting')

    // An analysis request just got an answer from the server.
    await notify(true)
    expect(screen.getByRole('status')).toHaveTextContent('API: connected')
  })
})
