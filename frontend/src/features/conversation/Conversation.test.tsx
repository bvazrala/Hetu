import { render, screen, within } from '@testing-library/react'
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

const NOTES: LearningState = { topic: null, goal: null, concepts: [], understood: [], misconceptions: [] }

function reply(text: string, extra: Partial<ChatResponse> = {}): ChatResponse {
  return { reply: text, action: 'explain', specialists: [], learning_state: NOTES, inspection: null, checks: [], ...extra }
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
    expect(screen.getByRole('heading', { name: 'What are you trying to understand?' })).toBeInTheDocument()
    expect(field()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Conversation' })).toHaveAttribute('aria-pressed', 'true')
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
    expect(within(hetu).getByText('Programming')).toBeInTheDocument()
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

  it('starts from a suggested question', async () => {
    chat.mockResolvedValue(reply('Rayleigh scattering.'))
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Why does the sky look blue?' }))
    expect(chat.mock.calls[0][0].messages[0].content).toBe('Why does the sky look blue?')
  })

  it('shows the result of an exact check apart from the reply', async () => {
    chat.mockResolvedValue(
      reply('Try a small number.', {
        checks: [{ tool: 'find_counterexample', result: 'COUNTEREXAMPLE: n = 2. The hypothesis holds and the conclusion fails.' }],
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
  it('is restored after a reload', async () => {
    chat.mockResolvedValue(reply('A class is a blueprint.'))
    const first = render(<App />)
    await say("I don't understand classes.")
    await screen.findByText('A class is a blueprint.')
    await vi.waitFor(() => expect(window.localStorage.getItem('hetu.session.v1')).toContain('blueprint'))
    first.unmount()

    render(<App />)
    expect(within(log()).getByText("I don't understand classes.")).toBeInTheDocument()
    expect(within(log()).getByText('A class is a blueprint.')).toBeInTheDocument()
  })

  it('can be started over, which also drops a reply that is still on its way', async () => {
    const pending = deferred<ChatResponse>()
    chat.mockResolvedValueOnce(reply('First reply.')).mockReturnValueOnce(pending.promise)
    render(<App />)
    await say('First question.')
    await screen.findByText('First reply.')
    await say('Second question.')

    await userEvent.click(screen.getByRole('button', { name: 'New session' }))
    pending.resolve(reply('A late reply.'))

    expect(await screen.findByRole('heading', { name: 'What are you trying to understand?' })).toBeInTheDocument()
    expect(screen.queryByText('A late reply.')).toBeNull()
    await vi.waitFor(() => expect(window.localStorage.getItem('hetu.session.v1')).toBeNull())
  })

  it('ignores damaged saved data', () => {
    window.localStorage.setItem('hetu.session.v1', '{"turns": "nope"')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'What are you trying to understand?' })).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Freeform' }))
    expect(screen.getByLabelText<HTMLTextAreaElement>('Your reasoning').value).toBe(DRAFT)

    // The conversation is still there when the student comes back.
    await userEvent.click(screen.getByRole('button', { name: 'Conversation' }))
    expect(within(log()).getByText('Look at your last step.')).toBeInTheDocument()
  })

  it('asks before replacing other work in the workspace', async () => {
    chat.mockResolvedValue(reply('Look at your last step.', { inspection }))
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Freeform' }))
    await userEvent.type(screen.getByLabelText('Your reasoning'), 'My unrelated essay.')
    await userEvent.click(screen.getByRole('button', { name: 'Conversation' }))
    await say('Here is my proof.')

    await userEvent.click(await screen.findByRole('button', { name: 'Open reasoning graph' }))
    expect(screen.getByText('This replaces the text in your workspace.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Freeform' }))
    expect(screen.getByLabelText<HTMLTextAreaElement>('Your reasoning').value).toBe('My unrelated essay.')
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
  it('takes a draft into the conversation from Freeform', async () => {
    chat.mockResolvedValue(reply('Here is what I see.'))
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Freeform' }))
    await userEvent.type(screen.getByLabelText('Your reasoning'), 'My essay introduction.')
    await userEvent.click(screen.getByRole('button', { name: 'Discuss with Hetu' }))

    expect(await screen.findByText('Here is what I see.')).toBeInTheDocument()
    expect(chat.mock.calls[0][0].workspace).toEqual({ problem: '', draft: 'My essay introduction.' })
    expect(screen.getByText('Sent with your workspace draft.')).toBeInTheDocument()
  })

  it('shares the draft only when the student ticks the box', async () => {
    chat.mockResolvedValue(reply('Okay.'))
    render(<App />)
    expect(screen.queryByLabelText(/Share my workspace draft/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Freeform' }))
    await userEvent.type(screen.getByLabelText('Your reasoning'), 'A draft.')
    await userEvent.click(screen.getByRole('button', { name: 'Conversation' }))

    await say('A question without the draft.')
    await screen.findByText('Okay.')
    expect(chat.mock.calls[0][0].workspace).toBeUndefined()

    await userEvent.click(screen.getByLabelText(/Share my workspace draft/))
    await say('Now with it.')
    await vi.waitFor(() => expect(chat.mock.calls[1][0].workspace).toEqual({ problem: '', draft: 'A draft.' }))
  })
})

describe('normalizeMath', () => {
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
