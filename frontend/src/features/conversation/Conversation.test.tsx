import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { AnalyzeError, sendChat } from '../../lib/api'
import { normalizeMath } from '../../lib/math'
import { DRAFT, LIVE_ANALYSIS, PROBLEM, deferred } from '../../test/fixtures'
import type { ChatResponse, LearningState } from '../../lib/types'

vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  sendChat: vi.fn(),
  analyzeDraft: vi.fn(),
  checkHealth: vi.fn().mockResolvedValue(true),
}))
const chat = vi.mocked(sendChat)

const NOTES: LearningState = {
  topic: null,
  goal: null,
  concepts: [],
  understood: [],
  misconceptions: [],
  open_questions: [],
  dismissed: [],
}

function reply(text: string, extra: Partial<ChatResponse> = {}): ChatResponse {
  return {
    reply: text,
    action: 'explain',
    specialists: [],
    learning_state: NOTES,
    inspection: null,
    checks: [],
    ...extra,
  }
}

const field = () => screen.getByLabelText<HTMLTextAreaElement>('Message Hetu')
const log = () => screen.getByRole('log', { name: 'Conversation' })

async function say(text: string) {
  await userEvent.type(field(), text)
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
}

beforeEach(() => chat.mockReset())

describe('the conversation', () => {
  it('is what a student sees first, with a place to type', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'What are you working on?' })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Starting point' })).getAllByRole('button')).toHaveLength(3)
    expect(field()).toBeInTheDocument()
    // The workspace is a panel the student opens, not a separate page.
    expect(screen.getByRole('button', { name: 'Workspace' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('sends a message and shows the reply with formatted code and math', async () => {
    chat.mockResolvedValue(
      reply('A class is a **blueprint**.\n\n```python\nclass Dog:\n    pass\n```\n\nIts area is $x^2$.', {
        specialists: ['programming'],
      }),
    )
    render(<App />)
    await say("I don't understand classes.")

    const hetu = await screen.findByRole('article', { name: 'Hetu said' })
    expect(within(log()).getByText("I don't understand classes.")).toBeInTheDocument()
    expect(within(hetu).getByText('blueprint').tagName).toBe('STRONG')
    expect(hetu.querySelector('pre code')).toHaveTextContent('class Dog:')
    expect(hetu.querySelector('.katex')).not.toBeNull()
    expect(hetu.querySelector('.katex-display')).toBeNull()
    // The subject label is gone: it told the student nothing they needed.
    expect(within(hetu).queryByText('Programming')).toBeNull()
    expect(field().value).toBe('')
  })

  it('sends earlier turns and the session notes with each new message', async () => {
    const notes = { ...NOTES, topic: 'classes', understood: ['a class is a blueprint'] }
    chat.mockResolvedValueOnce(reply('A class is a blueprint.', { learning_state: notes }))
    chat.mockResolvedValueOnce(reply('A function is one action.'))
    render(<App />)

    await say("I don't understand classes.")
    await screen.findByText('A class is a blueprint.')
    await say('How is that different from a function?')
    await screen.findByText('A function is one action.')

    const second = chat.mock.calls[1][0]
    expect(second.messages).toEqual([
      { role: 'student', content: "I don't understand classes." },
      { role: 'hetu', content: 'A class is a blueprint.' },
      { role: 'student', content: 'How is that different from a function?' },
    ])
    expect(second.learning_state).toEqual(notes)
  })

  it('sends with Enter and adds a line with Shift and Enter', async () => {
    chat.mockResolvedValue(reply('Hello.'))
    render(<App />)
    await userEvent.type(field(), 'line one{Shift>}{Enter}{/Shift}line two')
    expect(chat).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    expect(chat.mock.calls[0][0].messages[0].content).toBe('line one\nline two')
  })

  it('shows a waiting state and blocks a second send', async () => {
    const pending = deferred<ChatResponse>()
    chat.mockReturnValue(pending.promise)
    render(<App />)
    await say('Why is the sky blue?')

    expect(screen.getByText('Hetu is thinking…')).toBeInTheDocument()
    await userEvent.type(field(), 'another')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()

    // Let the request finish so nothing is left waiting when the test ends.
    pending.resolve(reply('Sunlight scatters.'))
    expect(await screen.findByText('Sunlight scatters.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('keeps the message after a failure and can try again', async () => {
    chat.mockRejectedValueOnce(new AnalyzeError('Hetu took too long to answer.'))
    chat.mockResolvedValueOnce(reply('Sunlight scatters.'))
    render(<App />)
    await say('Why is the sky blue?')

    expect(await screen.findByText('Hetu took too long to answer.')).toBeInTheDocument()
    expect(within(log()).getByText('Why is the sky blue?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Sunlight scatters.')).toBeInTheDocument()
    // The retry resends the same conversation without adding the message twice.
    expect(chat.mock.calls[1][0].messages).toHaveLength(1)
  })

  it('lets the student choose a starting point, which Hetu hears for the whole session', async () => {
    chat.mockResolvedValue(reply('What have you tried?'))
    render(<App />)
    const start = screen.getByRole('button', { name: /Work through a problem/ })
    await userEvent.click(start)

    expect(start).toHaveAttribute('aria-pressed', 'true')
    expect(field()).toHaveFocus()
    expect(field()).toHaveAttribute('placeholder', 'What is the problem, and where are you stuck?')

    await say('Integrate x times e to the x.')
    await screen.findByText('What have you tried?')
    await say('I tried substitution.')
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(2))
    expect(chat.mock.calls.map((call) => call[0].intent)).toEqual(['solve', 'solve'])
  })

  it('sends a chosen kind of help with one message only', async () => {
    chat.mockResolvedValue(reply('Try factoring.'))
    render(<App />)
    await userEvent.selectOptions(screen.getByLabelText('Help'), 'Give me a hint')
    await say('How do I solve x² − 5x + 6 = 0?')

    expect(chat.mock.calls[0][0].assist).toBe('hint')
    expect(within(log()).getByText('Asked for a hint')).toBeInTheDocument()
    expect(screen.getByLabelText<HTMLSelectElement>('Help').value).toBe('')

    await screen.findByText('Try factoring.')
    await say('Thanks.')
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(2))
    expect(chat.mock.calls[1][0].assist).toBeUndefined()
  })

  it('offers two follow-ups that fit the reply, and each sends a visible message', async () => {
    chat.mockResolvedValueOnce(reply('Light scatters off air.', { action: 'explain' }))
    chat.mockResolvedValueOnce(reply('Here is one.', { action: 'demonstrate' }))
    render(<App />)
    await say('Why is the sky blue?')
    await screen.findByText('Light scatters off air.')

    const next = screen.getByRole('group', { name: 'Next step' })
    expect(
      within(next)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Show an example', 'Let me try'])
    await userEvent.click(within(next).getByRole('button', { name: 'Show an example' }))

    expect(chat.mock.calls[1][0].assist).toBe('example')
    expect(within(log()).getByText('Show me an example.')).toBeInTheDocument()
    await screen.findByText('Here is one.')
    expect(
      within(screen.getByRole('group', { name: 'Next step' })).getByRole('button', { name: 'Let me try' }),
    ).toBeInTheDocument()
  })

  it('lets the student remove a note, and Hetu is told not to add it back', async () => {
    const notes = { ...NOTES, topic: 'inheritance', misconceptions: ['Thinks a subclass copies its parent'] }
    chat.mockResolvedValueOnce(reply('Not quite.', { learning_state: notes }))
    chat.mockResolvedValueOnce(reply('Okay.', { learning_state: notes }))
    render(<App />)
    await say('A subclass copies the parent code.')
    await screen.findByText('Not quite.')

    await userEvent.click(screen.getByText('Session notes'))
    await userEvent.click(screen.getByRole('button', { name: 'Remove note: Thinks a subclass copies its parent' }))
    expect(screen.queryByText('Thinks a subclass copies its parent')).toBeNull()

    await say('I meant something else.')
    await screen.findByText('Okay.')
    expect(chat.mock.calls[1][0].learning_state).toMatchObject({
      misconceptions: [],
      dismissed: ['Thinks a subclass copies its parent'],
    })
    // A reply that still lists the note does not bring it back.
    expect(screen.queryByText('Thinks a subclass copies its parent')).toBeNull()
  })

  it('shows the result of an exact check apart from the reply', async () => {
    chat.mockResolvedValue(
      reply('Try a small number.', {
        checks: [
          {
            tool: 'find_counterexample',
            result: 'COUNTEREXAMPLE: n = 2. The hypothesis holds and the conclusion fails.',
          },
        ],
      }),
    )
    render(<App />)
    await say('If 4 divides n² then 4 divides n.')
    expect(await screen.findByText('Checked by computation')).toBeInTheDocument()
    expect(screen.getByText(/COUNTEREXAMPLE: n = 2\./)).toBeInTheDocument()
  })

  it('shows session notes once Hetu has some, labelled as guesses', async () => {
    chat.mockResolvedValue(reply('Okay.', { learning_state: { ...NOTES, topic: 'derivatives', concepts: ['slope'] } }))
    render(<App />)
    expect(screen.queryByText('Session notes')).toBeNull()
    await say('Explain derivatives.')
    await screen.findByText('Okay.')
    await userEvent.click(screen.getByText('Session notes'))
    expect(screen.getByText('derivatives')).toBeInTheDocument()
    expect(screen.getByText(/not a measure of what you know/)).toBeInTheDocument()
  })
})

describe('a session', () => {
  it('is not kept after a reload for a guest', async () => {
    chat.mockResolvedValue(reply('A class is a blueprint.'))
    const first = render(<App />)
    await say("I don't understand classes.")
    await screen.findByText('A class is a blueprint.')
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(window.localStorage.getItem('hetu.session.v1')).toBeNull()
    first.unmount()

    render(<App />)
    expect(screen.getByRole('heading', { name: 'What are you working on?' })).toBeInTheDocument()
  })

  it('offers a conversation kept by an earlier version, and deletes it only when asked', async () => {
    const saved = { turns: [{ id: 1, role: 'student', content: 'An old question.' }], notes: null }
    window.localStorage.setItem('hetu.session.v1', JSON.stringify(saved))
    render(<App />)

    const notice = screen.getByRole('region', { name: /earlier visit/ })
    await userEvent.click(within(notice).getByRole('button', { name: 'Open it' }))
    expect(within(log()).getByText('An old question.')).toBeInTheDocument()
    // A guest keeps the old copy in the browser until they delete it.
    expect(window.localStorage.getItem('hetu.session.v1')).toContain('An old question.')
  })

  it('deletes the earlier conversation when the student chooses to', async () => {
    window.localStorage.setItem(
      'hetu.session.v1',
      JSON.stringify({ turns: [{ id: 1, role: 'student', content: 'Old.' }] }),
    )
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete it' }))
    expect(window.localStorage.getItem('hetu.session.v1')).toBeNull()
    expect(screen.queryByRole('region', { name: /earlier visit/ })).toBeNull()
  })

  it('can be started over, which also drops a reply that is still on its way', async () => {
    const pending = deferred<ChatResponse>()
    chat.mockResolvedValueOnce(reply('First reply.')).mockReturnValueOnce(pending.promise)
    render(<App />)
    await say('First question.')
    await screen.findByText('First reply.')
    await say('Second question.')

    await userEvent.click(screen.getByRole('button', { name: 'New' }))
    pending.resolve(reply('A late reply.'))

    expect(await screen.findByRole('heading', { name: 'What are you working on?' })).toBeInTheDocument()
    expect(screen.queryByText('A late reply.')).toBeNull()
  })

  it('ignores damaged saved data', () => {
    window.localStorage.setItem('hetu.session.v1', '{"turns": "nope"')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'What are you working on?' })).toBeInTheDocument()
  })
})

describe('proofs in the conversation', () => {
  const inspection = { problem: PROBLEM, draft: DRAFT, analysis: LIVE_ANALYSIS }

  it('offers the reasoning graph only when a proof was inspected', async () => {
    chat.mockResolvedValueOnce(reply('A class is a blueprint.'))
    chat.mockResolvedValueOnce(reply('Look at your last step.', { inspection, specialists: ['mathematics'] }))
    render(<App />)

    await say("I don't understand classes.")
    await screen.findByText('A class is a blueprint.')
    expect(screen.queryByRole('button', { name: 'Open reasoning graph' })).toBeNull()

    await say('Here is my proof.')
    expect(await screen.findByRole('button', { name: 'Open reasoning graph' })).toBeInTheDocument()
  })

  it('opens the graph with the proof loaded into the workspace', async () => {
    chat.mockResolvedValue(reply('Look at your last step.', { inspection }))
    render(<App />)
    await say('Here is my proof.')
    await userEvent.click(await screen.findByRole('button', { name: 'Open reasoning graph' }))

    expect(screen.getByRole('heading', { name: 'Analysis' })).toHaveFocus()
    expect(screen.getByRole('group', { name: /reasoning graph/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Draft' }))
    expect(screen.getByLabelText<HTMLTextAreaElement>('Your work').value).toBe(DRAFT)

    // The conversation is still there when the student comes back.
    await userEvent.click(screen.getByRole('button', { name: 'Back to conversation' }))
    expect(within(log()).getByText('Look at your last step.')).toBeInTheDocument()
  })

  it('asks before replacing other work in the workspace', async () => {
    chat.mockResolvedValue(reply('Look at your last step.', { inspection }))
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    await userEvent.type(screen.getByLabelText('Your work'), 'My unrelated essay.')
    await userEvent.click(screen.getByRole('button', { name: 'Back to conversation' }))
    await say('Here is my proof.')

    await userEvent.click(await screen.findByRole('button', { name: 'Open reasoning graph' }))
    expect(screen.getByText('This replaces the text in your workspace.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    expect(screen.getByLabelText<HTMLTextAreaElement>('Your work').value).toBe('My unrelated essay.')
  })

  it('sends the open question back when the student replies, so a disagreement can be reconsidered', async () => {
    chat.mockResolvedValueOnce(reply('Look at your last step.', { inspection }))
    chat.mockResolvedValueOnce(reply('I looked again.'))
    render(<App />)
    await say('Here is my proof.')
    await screen.findByText('Look at your last step.')
    await say('I disagree.')
    await screen.findByText('I looked again.')

    expect(chat.mock.calls[0][0].proof_context).toBeUndefined()
    expect(chat.mock.calls[1][0].proof_context).toEqual({
      problem: PROBLEM,
      draft: DRAFT,
      step_text: 'so n must be even.',
      question: LIVE_ANALYSIS.observations[0].question,
    })
  })
})

describe('the workspace and the conversation', () => {
  it('sends the whole draft for feedback and returns to the conversation', async () => {
    chat.mockResolvedValue(reply('Here is what I see.'))
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    await userEvent.type(screen.getByLabelText('Your work'), 'My essay introduction.')
    await userEvent.click(screen.getByRole('button', { name: 'Get feedback' }))

    expect(await screen.findByText('Here is what I see.')).toBeInTheDocument()
    expect(chat.mock.calls[0][0].workspace).toEqual({ problem: '', draft: 'My essay introduction.' })
    expect(chat.mock.calls[0][0].assist).toBe('check')
    expect(screen.getByText(/Workspace included/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Workspace' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('quotes a selected part of the draft in the composer, with the workspace included', async () => {
    chat.mockResolvedValue(reply('That sentence makes a claim.'))
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    const draft = screen.getByLabelText<HTMLTextAreaElement>('Your work')
    await userEvent.type(draft, 'Factories grew. Wages rose for some.')
    draft.setSelectionRange(16, 36)
    fireEvent.select(draft)
    await userEvent.click(screen.getByRole('button', { name: 'Ask about the selection' }))

    expect(field().value).toBe('> Wages rose for some.\n\n')
    expect(field()).toHaveFocus()
    expect(screen.getByLabelText('Include my workspace')).toBeChecked()
    await userEvent.type(field(), 'Is this evidence?')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(chat.mock.calls[0][0].messages[0].content).toBe('> Wages rose for some.\n\nIs this evidence?')
    expect(chat.mock.calls[0][0].workspace).toEqual({ problem: '', draft: 'Factories grew. Wages rose for some.' })
    expect(within(log()).getByText('Wages rose for some.').tagName).toBe('BLOCKQUOTE')
  })

  it('quotes a step from the structure view in the composer', async () => {
    chat.mockResolvedValue(
      reply('Look at your last step.', { inspection: { problem: PROBLEM, draft: DRAFT, analysis: LIVE_ANALYSIS } }),
    )
    render(<App />)
    await say('Here is my proof.')
    await userEvent.click(await screen.findByRole('button', { name: 'Open reasoning graph' }))
    await userEvent.click(screen.getByRole('button', { name: 'Ask about this step' }))
    expect(field().value).toBe('> so n must be even.\n\n')
  })

  it('shares the draft only when the student ticks the box', async () => {
    chat.mockResolvedValue(reply('Okay.'))
    render(<App />)
    expect(screen.queryByLabelText('Include my workspace')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    await userEvent.type(screen.getByLabelText('Your work'), 'A draft.')
    await userEvent.click(screen.getByRole('button', { name: 'Back to conversation' }))

    await say('A question without the draft.')
    await screen.findByText('Okay.')
    expect(chat.mock.calls[0][0].workspace).toBeUndefined()

    await userEvent.click(screen.getByLabelText('Include my workspace'))
    await say('Now with it.')
    await vi.waitFor(() => expect(chat.mock.calls[1][0].workspace).toEqual({ problem: '', draft: 'A draft.' }))
  })
})

describe('graphs in a reply', () => {
  it('draws a plot block as a graph with a text description', async () => {
    chat.mockResolvedValue(
      reply(
        'Here it is.\n\n```plot\n{"variable": "t", "x": [0, 4], "xLabel": "t (s)", "functions": [{"expr": "2*t^2", "label": "s = 2t^2"}]}\n```',
      ),
    )
    render(<App />)
    await say('Graph it.')
    const graph = await screen.findByRole('img', { name: 'Graph of s = 2t^2, for t (s) from 0 to 4.' })
    expect(graph.querySelector('polyline')).not.toBeNull()
    expect(screen.queryByText(/"functions"/)).toBeNull()
  })

  it('says why a graph could not be drawn instead of failing silently', async () => {
    chat.mockResolvedValue(reply('```plot\n{"x": [0, 1], "functions": ["alert(1)"]}\n```'))
    render(<App />)
    await say('Graph it.')
    expect(await screen.findByText('This graph could not be drawn.')).toBeInTheDocument()
    expect(screen.getByText(/"alert" is not a known name/)).toBeInTheDocument()
  })
})

describe('normalizeMath', () => {
  it('keeps a displayed equation inline inside a table row, so the table stays whole', () => {
    const table = '| Law | Formula |\n| --- | --- |\n| 2nd | $$F = ma$$ |\n| 3rd | \\[F_{AB} = -F_{BA}\\] |'
    expect(normalizeMath(table)).toBe(
      '| Law | Formula |\n| --- | --- |\n| 2nd | $F = ma$ |\n| 3rd | $F_{AB} = -F_{BA}$ |',
    )
  })

  it('renders such a table with every row intact', async () => {
    chat.mockResolvedValue(
      reply('| Law | Formula |\n| --- | --- |\n| 2nd | $$F = ma$$ |\n| 3rd | Equal and opposite |'),
    )
    render(<App />)
    await say('Newton?')
    const hetu = await screen.findByRole('article', { name: 'Hetu said' })
    expect(hetu.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(hetu.querySelector('td .katex')).not.toBeNull()
    expect(hetu.textContent).not.toContain('|')
  })

  it('converts bracket delimiters to dollar delimiters', () => {
    expect(normalizeMath('So \\(x^2\\) holds.')).toBe('So $x^2$ holds.')
  })

  it('puts a displayed equation on its own lines, whichever way it was written', () => {
    const expected = 'So\n\n$$\ny = 1\n$$\n\n'
    expect(normalizeMath('So\\[y = 1\\]')).toBe(expected)
    expect(normalizeMath('So$$y = 1$$')).toBe(expected)
  })

  it('leaves code untouched', () => {
    const text = 'Use `\\(x\\)` or\n```\n\\[a\\]\n```'
    expect(normalizeMath(text)).toBe(text)
  })
})
