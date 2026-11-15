import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { analyzeDraft } from './lib/api'
import { DRAFT, LIVE_ANALYSIS, NO_GAP_ANALYSIS } from './test/fixtures'

vi.mock('./lib/api', async (original) => ({
  ...(await original<typeof import('./lib/api')>()),
  analyzeDraft: vi.fn(),
  checkHealth: vi.fn().mockResolvedValue(true),
}))
const analyze = vi.mocked(analyzeDraft)

const draftField = () => screen.getByLabelText<HTMLTextAreaElement>('Your work')

async function openWorkspace() {
  await userEvent.click(screen.getByRole('button', { name: 'Workspace' }))
}

async function inspectTheExample() {
  render(<App />)
  await openWorkspace()
  await userEvent.click(screen.getByRole('button', { name: 'Try an example' }))
  await userEvent.click(screen.getByRole('button', { name: 'Map the steps' }))
  await screen.findByRole('heading', { name: 'Analysis' })
}

beforeEach(() => analyze.mockReset())

describe('the whole loop', () => {
  it('moves focus to the analysis when it arrives', async () => {
    analyze.mockResolvedValue(LIVE_ANALYSIS)
    await inspectTheExample()
    expect(screen.getByRole('heading', { name: 'Analysis' })).toHaveFocus()
  })

  it('revise: returns to the editor with the step selected and the draft intact', async () => {
    analyze.mockResolvedValue(LIVE_ANALYSIS)
    await inspectTheExample()

    await userEvent.click(screen.getByRole('button', { name: 'Revise this step' }))

    const field = draftField()
    expect(field).toHaveFocus()
    expect(field.value).toBe(DRAFT)
    expect(field.value.slice(field.selectionStart, field.selectionEnd)).toBe('so n must be even.')
  })

  it('revise then inspect again: the new text is what gets analyzed', async () => {
    analyze.mockResolvedValueOnce(LIVE_ANALYSIS).mockResolvedValueOnce(NO_GAP_ANALYSIS)
    await inspectTheExample()
    await userEvent.click(screen.getByRole('button', { name: 'Revise this step' }))

    // Typing replaces the selected step, as it would for a student.
    await userEvent.keyboard('so n is even because an odd n has an odd square.')
    await userEvent.click(screen.getByRole('button', { name: 'Map the steps' }))

    expect(await screen.findByText('Hetu has no question about this draft.')).toBeInTheDocument()
    expect(analyze.mock.calls[1][1]).toContain('an odd n has an odd square.')
    expect(analyze.mock.calls[1][1]).not.toContain('so n must be even.')
  })

  it('challenge: the reply is shown and the draft is untouched', async () => {
    analyze.mockResolvedValueOnce(LIVE_ANALYSIS).mockResolvedValueOnce({
      ...LIVE_ANALYSIS,
      challenge: { outcome: 'maintained', response: 'The draft still does not say why.' },
    })
    await inspectTheExample()

    await userEvent.click(screen.getByRole('button', { name: 'Challenge Hetu' }))
    await userEvent.type(screen.getByLabelText('Why do you think this step is justified?'), 'It is obvious.')
    await userEvent.click(screen.getByRole('button', { name: 'Send challenge' }))

    const exchange = await screen.findByRole('region', { name: 'Hetu still has its question' })
    expect(within(exchange).getByText('It is obvious.')).toBeInTheDocument()
    expect(within(exchange).getByText('The draft still does not say why.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Draft' }))
    expect(draftField().value).toBe(DRAFT)
  })

  it('shows a draft kept by an earlier version, and clearing removes it after asking', async () => {
    window.localStorage.setItem('hetu.workspace.v1', JSON.stringify({ problem: '', draft: 'A draft worth keeping.' }))
    render(<App />)
    await openWorkspace()
    expect(draftField().value).toBe('A draft worth keeping.')
    expect(screen.getByText('Not saved. Stays in this tab.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear workspace' }))
    expect(draftField().value).toBe('A draft worth keeping.')
    await userEvent.click(screen.getByRole('button', { name: 'Yes, clear' }))
    expect(draftField().value).toBe('')
    expect(window.localStorage.getItem('hetu.workspace.v1')).toBeNull()
  })
})
