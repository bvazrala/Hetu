import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyzeError, analyzeDraft } from '../../lib/api'
import { saveWorkspace } from '../../lib/storage'
import { DRAFT, LIVE_ANALYSIS, NO_GAP_ANALYSIS, PROBLEM, deferred } from '../../test/fixtures'
import type { Analysis } from '../../lib/types'
import { DISCARDED_NOTICE, useWorkspace } from './useWorkspace'

vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  analyzeDraft: vi.fn(),
}))
const analyze = vi.mocked(analyzeDraft)

function setup() {
  const view = renderHook(() => useWorkspace())
  return { ...view, workspace: () => view.result.current }
}

function type(workspace: () => ReturnType<typeof useWorkspace>, problem: string, draft: string) {
  act(() => {
    workspace().setProblem(problem)
    workspace().setDraft(draft)
  })
}

beforeEach(() => analyze.mockReset())

describe('inspecting a draft', () => {
  it('shows the analysis and switches to the Structured view', async () => {
    analyze.mockResolvedValue(LIVE_ANALYSIS)
    const { workspace } = setup()
    type(workspace, PROBLEM, DRAFT)

    await act(() => workspace().inspect())

    expect(analyze).toHaveBeenCalledWith(PROBLEM, DRAFT)
    expect(workspace().mode).toBe('structured')
    expect(workspace().inspection?.analysis).toBe(LIVE_ANALYSIS)
    expect(workspace().stale).toBe(false)
  })

  it('reports a failure and keeps the draft', async () => {
    analyze.mockRejectedValueOnce(new AnalyzeError('The analysis took too long.'))
    const { workspace } = setup()
    type(workspace, 'My problem', 'My own draft.')

    await act(() => workspace().inspect())

    expect(workspace().error).toBe('The analysis took too long.')
    expect(workspace().draft).toBe('My own draft.')
    expect(workspace().mode).not.toBe('structured')
    expect(workspace().inspection).toBeNull()
  })

  it('falls back to the labelled sample for the unedited example', async () => {
    analyze.mockRejectedValueOnce(new AnalyzeError('The analysis server could not be reached.'))
    const { workspace } = setup()
    act(() => workspace().loadExample())

    await act(() => workspace().inspect())

    expect(workspace().inspection?.analysis.source).toBe('sample')
    expect(workspace().inspection?.fallbackReason).toBe('The analysis server could not be reached.')
  })
})

describe('a response that arrives after the draft changed', () => {
  it('is discarded: no switch of view, no stale feedback, and the new text is kept', async () => {
    const request = deferred<Analysis>()
    analyze.mockReturnValue(request.promise)
    const { workspace } = setup()
    type(workspace, PROBLEM, DRAFT)

    act(() => void workspace().inspect())
    expect(workspace().busy).toBe('inspect')

    // The student keeps writing while the request is out.
    act(() => workspace().setDraft(DRAFT + ' Also, n is positive.'))
    await act(async () => request.resolve(LIVE_ANALYSIS))

    expect(workspace().mode).not.toBe('structured')
    expect(workspace().inspection).toBeNull()
    expect(workspace().stale).toBe(false)
    expect(workspace().notice).toBe(DISCARDED_NOTICE)
    expect(workspace().draft).toBe(DRAFT + ' Also, n is positive.')
    expect(workspace().busy).toBeNull()
  })

  it('leaves the way open for a fresh analysis of the new text', async () => {
    const first = deferred<Analysis>()
    analyze.mockReturnValueOnce(first.promise).mockResolvedValueOnce(NO_GAP_ANALYSIS)
    const { workspace } = setup()
    type(workspace, PROBLEM, DRAFT)

    act(() => void workspace().inspect())
    act(() => workspace().setDraft('A new draft.'))
    await act(async () => first.resolve(LIVE_ANALYSIS))
    await act(() => workspace().inspect())

    expect(analyze).toHaveBeenLastCalledWith(PROBLEM, 'A new draft.')
    expect(workspace().inspection?.analysis).toBe(NO_GAP_ANALYSIS)
    expect(workspace().notice).toBeNull()
  })

  it('is ignored entirely when the workspace was cleared in the meantime', async () => {
    const request = deferred<Analysis>()
    analyze.mockReturnValue(request.promise)
    const { workspace } = setup()
    type(workspace, PROBLEM, DRAFT)

    act(() => void workspace().inspect())
    act(() => workspace().reset())
    await act(async () => request.resolve(LIVE_ANALYSIS))

    expect(workspace().inspection).toBeNull()
    expect(workspace().notice).toBeNull()
    expect(workspace().draft).toBe('')
    expect(workspace().busy).toBeNull()
  })
})

describe('an analysis and later edits', () => {
  it('stops being shown once the draft changes, and returns if the change is undone', async () => {
    analyze.mockResolvedValue(LIVE_ANALYSIS)
    const { workspace } = setup()
    type(workspace, PROBLEM, DRAFT)
    await act(() => workspace().inspect())

    act(() => workspace().setDraft(DRAFT + '!'))
    expect(workspace().inspection).toBeNull()
    expect(workspace().stale).toBe(true)

    act(() => workspace().setDraft(DRAFT))
    expect(workspace().inspection?.analysis).toBe(LIVE_ANALYSIS)
  })
})

describe('saving work in the browser', () => {
  it('restores the saved problem and draft on load', () => {
    saveWorkspace({ problem: 'Saved problem', draft: 'Saved draft' })
    const { workspace } = setup()
    expect(workspace().problem).toBe('Saved problem')
    expect(workspace().draft).toBe('Saved draft')
  })

  it('starts empty when the saved data is damaged', () => {
    window.localStorage.setItem('hetu.workspace.v1', '{broken')
    const { workspace } = setup()
    expect(workspace().draft).toBe('')
  })

  it('saves after a pause, not on every keystroke', async () => {
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const { workspace } = setup()

    for (const text of ['A', 'As', 'Ass', 'Assume']) act(() => workspace().setDraft(text))
    expect(write).not.toHaveBeenCalled()

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(JSON.parse(write.mock.calls[0][1])).toEqual({ problem: '', draft: 'Assume' })
  })

  it('clears the saved work when the workspace is reset', async () => {
    saveWorkspace({ problem: 'p', draft: 'd' })
    const { workspace } = setup()

    act(() => workspace().reset())

    expect(workspace().problem).toBe('')
    expect(workspace().draft).toBe('')
    expect(window.localStorage.getItem('hetu.workspace.v1')).toBeNull()
  })
})

describe('challenging a question', () => {
  const [, , flaggedNode] = LIVE_ANALYSIS.nodes
  const [observation] = LIVE_ANALYSIS.observations

  async function inspected() {
    analyze.mockResolvedValueOnce(LIVE_ANALYSIS)
    const view = setup()
    type(view.workspace, PROBLEM, DRAFT)
    await act(() => view.workspace().inspect())
    return view
  }

  it('sends the step, the question, and the student reason, and shows the reply', async () => {
    const { workspace } = await inspected()
    const reply: Analysis = { ...NO_GAP_ANALYSIS, challenge: { outcome: 'withdrawn', response: 'Agreed.' } }
    analyze.mockResolvedValueOnce(reply)

    await act(() => workspace().challenge(flaggedNode, observation, 'It follows by definition.'))

    expect(analyze).toHaveBeenLastCalledWith(PROBLEM, DRAFT, {
      step_text: flaggedNode.text,
      question: observation.question,
      reason: 'It follows by definition.',
    })
    expect(workspace().inspection?.analysis.challenge?.outcome).toBe('withdrawn')
    expect(workspace().inspection?.challengeReason).toBe('It follows by definition.')
    expect(workspace().draft).toBe(DRAFT)
  })

  it('keeps the earlier analysis when the challenge request fails', async () => {
    const { workspace } = await inspected()
    analyze.mockRejectedValueOnce(new AnalyzeError('Too many requests. Wait a minute and try again.'))

    await act(() => workspace().challenge(flaggedNode, observation, 'A reason.'))

    expect(workspace().challengeError).toBe('Too many requests. Wait a minute and try again.')
    expect(workspace().inspection?.analysis).toBe(LIVE_ANALYSIS)
  })

  it('is not sent for a draft that has changed since the analysis', async () => {
    const { workspace } = await inspected()
    act(() => workspace().setDraft(DRAFT + ' More.'))

    await act(() => workspace().challenge(flaggedNode, observation, 'A reason.'))

    expect(analyze).toHaveBeenCalledTimes(1)
  })
})

describe('revising a step', () => {
  it('returns to Freeform and asks for the step to be selected', async () => {
    analyze.mockResolvedValue(LIVE_ANALYSIS)
    const { workspace } = setup()
    type(workspace, PROBLEM, DRAFT)
    await act(() => workspace().inspect())
    const node = LIVE_ANALYSIS.nodes[2]

    act(() => workspace().reviseStep(node))

    expect(workspace().mode).toBe('freeform')
    const range = workspace().focusRequest!.range!
    expect(DRAFT.slice(range.start, range.end)).toBe(node.text)
    expect(workspace().draft).toBe(DRAFT)
  })

  it('only focuses the editor when the step has no known position', async () => {
    analyze.mockResolvedValue(LIVE_ANALYSIS)
    const { workspace } = setup()
    type(workspace, PROBLEM, DRAFT)
    await act(() => workspace().inspect())

    act(() => workspace().reviseStep({ ...LIVE_ANALYSIS.nodes[2], span: null }))

    expect(workspace().mode).toBe('freeform')
    expect(workspace().focusRequest).toEqual({ range: null })
  })
})
