import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DRAFT, LIVE_ANALYSIS, NO_GAP_ANALYSIS, PROBLEM } from '../../test/fixtures'
import type { Analysis } from '../../lib/types'
import type { Inspection } from '../workspace/useWorkspace'
import { StructuredView } from './StructuredView'

function inspectionOf(analysis: Analysis, extra: Partial<Inspection> = {}): Inspection {
  return { problem: PROBLEM, draft: DRAFT, analysis, fallbackReason: null, challengeReason: null, ...extra }
}

function show(inspection: Inspection | null, props: Partial<Parameters<typeof StructuredView>[0]> = {}) {
  const handlers = { onInspect: vi.fn(), onRevise: vi.fn(), onDiscuss: vi.fn(), onChallenge: vi.fn() }
  render(
    <StructuredView
      draft={DRAFT}
      inspection={inspection}
      stale={false}
      busy={null}
      error={null}
      challengeError={null}
      headingRef={createRef()}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

const graph = () => screen.getByRole('group', { name: /reasoning graph/i })
const graphStep = (number: number) => within(graph()).getByRole('button', { name: new RegExp(`^Step ${number} `) })
const detail = () => screen.getByRole('region', { name: 'Selected step' })
const stepList = () => screen.getByRole('list', { name: 'Steps as text' })

describe('the reasoning graph', () => {
  it('draws one button per step and one arrow per dependency', () => {
    show(inspectionOf(LIVE_ANALYSIS))
    expect(within(graph()).getAllByRole('button')).toHaveLength(3)
    expect(graph().querySelectorAll('path[data-from]')).toHaveLength(2)
  })

  it('runs each arrow from the prerequisite to the step that relies on it', () => {
    show(inspectionOf(LIVE_ANALYSIS))
    // The API edge is: n2 depends on n1.
    expect(graph().querySelector('path[data-from="n1"][data-to="n2"]')).not.toBeNull()
    expect(graph().querySelector('path[data-from="n2"][data-to="n1"]')).toBeNull()
  })

  it('describes each step, its dependencies, and any question to screen readers', () => {
    show(inspectionOf(LIVE_ANALYSIS))
    // The name starts with the visible text, then adds what the arrows show.
    expect(graphStep(1)).toHaveAccessibleName(
      'Step 1 · Assumption Assume n² = 2k for some integer k. Relies on no other step.',
    )
    expect(graphStep(3)).toHaveAccessibleName(/Relies on step 2\. Hetu has a question about this step\.$/)
  })

  it('moves between steps with the arrow keys', async () => {
    show(inspectionOf(LIVE_ANALYSIS))
    graphStep(1).focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(graphStep(2)).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(graphStep(1)).toHaveFocus()
  })
})

describe('selecting a step', () => {
  it('starts on the step that has a question and shows the question', () => {
    show(inspectionOf(LIVE_ANALYSIS))
    expect(graphStep(3)).toHaveAttribute('aria-pressed', 'true')
    expect(within(detail()).getByText('Hetu\'s question')).toBeInTheDocument()
    expect(within(detail()).getByText(/relies on:/i).nextSibling).toHaveTextContent('step 2')
    expect(within(detail()).getByRole('button', { name: 'Challenge Hetu' })).toBeInTheDocument()
  })

  it('shows a step without a question as unquestioned, not as correct', async () => {
    show(inspectionOf(LIVE_ANALYSIS))
    await userEvent.click(graphStep(1))

    expect(graphStep(1)).toHaveAttribute('aria-pressed', 'true')
    expect(graphStep(3)).toHaveAttribute('aria-pressed', 'false')
    expect(within(detail()).getByText(/has not checked that the step is correct/i)).toBeInTheDocument()
    expect(within(detail()).queryByText('Hetu\'s question')).toBeNull()
    expect(within(detail()).queryByRole('button', { name: 'Challenge Hetu' })).toBeNull()
    expect(within(detail()).getByText(/used by:/i).nextSibling).toHaveTextContent('step 2')
  })

  it('marks the same step in the text list', async () => {
    show(inspectionOf(LIVE_ANALYSIS))
    const items = () => within(stepList()).getAllByRole('listitem')
    expect(items()[2]).toHaveAttribute('aria-current', 'true')

    await userEvent.click(graphStep(2))
    expect(items()[1]).toHaveAttribute('aria-current', 'true')
    expect(items()[2]).not.toHaveAttribute('aria-current')
  })

  it('can also be done from the text list', async () => {
    show(inspectionOf(LIVE_ANALYSIS))
    await userEvent.click(within(stepList()).getByRole('button', { name: /^Step 1,/ }))
    expect(graphStep(1)).toHaveAttribute('aria-pressed', 'true')
  })

  it('highlights the selected step in the draft', async () => {
    show(inspectionOf(LIVE_ANALYSIS))
    expect(document.querySelector('mark')).toHaveTextContent('so n must be even.')
    await userEvent.click(graphStep(1))
    expect(document.querySelector('mark')).toHaveTextContent('Assume n² = 2k for some integer k.')
  })

  it('starts with nothing selected when there is no question', () => {
    show(inspectionOf(NO_GAP_ANALYSIS))
    expect(screen.getByText('Hetu has no question about this draft.')).toBeInTheDocument()
    expect(within(graph()).queryByRole('button', { pressed: true })).toBeNull()
    expect(document.querySelector('mark')).toBeNull()
  })
})

describe('a step that was not found in the draft', () => {
  const unmatched: Analysis = {
    ...LIVE_ANALYSIS,
    nodes: LIVE_ANALYSIS.nodes.map((node) => (node.id === 'n3' ? { ...node, span: null } : node)),
  }

  it('is labelled as unmatched and highlights nothing', () => {
    show(inspectionOf(unmatched))
    expect(graphStep(3)).toHaveAccessibleName(/Not matched to exact text in your draft\./)
    expect(within(detail()).getByText(/could not find this exact wording/i)).toBeInTheDocument()
    expect(document.querySelector('mark')).toBeNull()
    // The draft itself is still shown in full.
    expect(screen.getByText(DRAFT)).toBeInTheDocument()
  })
})

describe('acting on a step', () => {
  it('asks to revise the selected step', async () => {
    const { onRevise } = show(inspectionOf(LIVE_ANALYSIS))
    await userEvent.click(within(detail()).getByRole('button', { name: 'Revise this step' }))
    expect(onRevise).toHaveBeenCalledWith(LIVE_ANALYSIS.nodes[2])
  })

  it('sends a challenge with the student reason', async () => {
    const { onChallenge } = show(inspectionOf(LIVE_ANALYSIS))
    await userEvent.click(within(detail()).getByRole('button', { name: 'Challenge Hetu' }))
    expect(within(detail()).getByRole('button', { name: 'Send challenge' })).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Why do you think this step is justified?'), 'It is a definition.')
    await userEvent.click(within(detail()).getByRole('button', { name: 'Send challenge' }))

    expect(onChallenge).toHaveBeenCalledWith(
      LIVE_ANALYSIS.nodes[2],
      LIVE_ANALYSIS.observations[0],
      'It is a definition.',
    )
  })

  it('does not offer a challenge on the hand-written sample', () => {
    show(inspectionOf({ ...LIVE_ANALYSIS, source: 'sample' }))
    expect(screen.queryByRole('button', { name: 'Challenge Hetu' })).toBeNull()
  })

  it('shows both sides after a challenge', () => {
    const answered: Analysis = {
      ...NO_GAP_ANALYSIS,
      challenge: { outcome: 'withdrawn', response: 'You are right. I withdraw the question.' },
    }
    show(inspectionOf(answered, { challengeReason: 'It is a definition.' }))

    const exchange = screen.getByRole('region', { name: 'Hetu withdrew its question' })
    expect(within(exchange).getByText('It is a definition.')).toBeInTheDocument()
    expect(within(exchange).getByText('You are right. I withdraw the question.')).toBeInTheDocument()
  })

  it('says so when the question stands after a challenge', () => {
    const answered: Analysis = { ...LIVE_ANALYSIS, challenge: { outcome: 'maintained', response: 'Still open.' } }
    show(inspectionOf(answered, { challengeReason: 'It is obvious.' }))
    expect(screen.getByRole('region', { name: 'Hetu still has its question' })).toBeInTheDocument()
  })
})

describe('when there is no current analysis', () => {
  it('explains how to get one', () => {
    show(null)
    expect(screen.getByRole('heading', { name: 'Nothing inspected yet.' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Inspect current draft' })).toBeNull()
  })

  it('offers a fresh analysis instead of showing outdated feedback', async () => {
    const { onInspect } = show(null, { stale: true })
    expect(screen.queryByText('Hetu\'s question')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Inspect current draft' }))
    expect(onInspect).toHaveBeenCalled()
  })
})

describe('zoom', () => {
  it('starts fitted and can zoom out and back in', async () => {
    show(inspectionOf(LIVE_ANALYSIS))
    const zoom = screen.getByRole('group', { name: 'Zoom' })
    expect(within(zoom).getByRole('button', { name: 'Fit' })).toHaveAttribute('aria-pressed', 'true')
    expect(zoom).toHaveTextContent('100%')
    await userEvent.click(within(zoom).getByRole('button', { name: 'Zoom out' }))
    expect(zoom).toHaveTextContent('90%')
    expect(within(zoom).getByRole('button', { name: 'Fit' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(within(zoom).getByRole('button', { name: 'Zoom in' }))
    expect(zoom).toHaveTextContent('100%')
  })
})
