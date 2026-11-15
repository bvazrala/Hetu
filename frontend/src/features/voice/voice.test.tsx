import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { sendChat } from '../../lib/api'
import type { ChatResponse } from '../../lib/types'
import { stop, toSpeech } from './speech'

vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  sendChat: vi.fn(),
  checkHealth: vi.fn().mockResolvedValue(true),
}))
const chat = vi.mocked(sendChat)

const NOTES = { topic: null, goal: null, concepts: [], understood: [], misconceptions: [], open_questions: [], dismissed: [] }
const reply = (text: string): ChatResponse => ({
  reply: text,
  action: 'explain',
  specialists: [],
  learning_state: NOTES,
  inspection: null,
  checks: [],
})

/** A stand-in for the browser's speech recognition. The test plays the part of the speaker. */
class FakeRecognition {
  static last: FakeRecognition | null = null
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn(() => this.onend?.())
  abort = vi.fn()
  constructor() {
    FakeRecognition.last = this
  }
  hear(...phrases: [string, boolean][]) {
    act(() =>
      this.onresult?.({ resultIndex: 0, results: phrases.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })) }),
    )
  }
}

const field = () => screen.getByLabelText<HTMLTextAreaElement>('Message Hetu')

beforeEach(() => chat.mockReset())
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  delete (window as unknown as Record<string, unknown>).speechSynthesis
  delete (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance
  stop()
})

describe('dictation', () => {
  it('adds what is heard to the message box and never sends by itself', async () => {
    ;(window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition
    render(<App />)
    await userEvent.type(field(), 'Question:')
    await userEvent.click(screen.getByRole('button', { name: 'Dictate a message' }))

    expect(screen.getByRole('button', { name: 'Stop dictation' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/^Listening\./)).toBeInTheDocument()
    FakeRecognition.last!.hear(['why is the sky', true], [' blue', false])
    expect(field().value).toBe('Question: why is the sky blue')

    await userEvent.click(screen.getByRole('button', { name: 'Stop dictation' }))
    expect(FakeRecognition.last!.stop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Dictate a message' })).toHaveAttribute('aria-pressed', 'false')
    expect(chat).not.toHaveBeenCalled()
  })

  it('explains a blocked microphone', async () => {
    ;(window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate a message' }))
    act(() => FakeRecognition.last!.onerror?.({ error: 'not-allowed' }))
    expect(screen.getByText(/Microphone access is blocked/)).toBeInTheDocument()
  })

  it('says so when the browser cannot dictate, and typing still works', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Dictate a message' }))
    expect(screen.getByText(/Dictation is not available in this browser/)).toBeInTheDocument()
    await userEvent.type(field(), 'typed instead')
    expect(field().value).toBe('typed instead')
  })
})

describe('reading aloud', () => {
  function fakeSynthesis() {
    const synthesis = { speak: vi.fn(), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() }
    ;(window as unknown as Record<string, unknown>).speechSynthesis = synthesis
    ;(window as unknown as Record<string, unknown>).SpeechSynthesisUtterance = class {
      text: string
      rate = 1
      lang = ''
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(text: string) {
        this.text = text
      }
    }
    return synthesis
  }

  it('plays one reply at a time, with pause and stop', async () => {
    const synthesis = fakeSynthesis()
    chat.mockResolvedValueOnce(reply('First answer.')).mockResolvedValueOnce(reply('Second answer.'))
    render(<App />)
    await userEvent.type(field(), 'One{Enter}')
    await screen.findByText('First answer.')
    await userEvent.type(field(), 'Two{Enter}')
    await screen.findByText('Second answer.')

    const [first, second] = screen.getAllByRole('article', { name: 'Hetu said' })
    await userEvent.click(within(first).getByRole('button', { name: 'Listen' }))
    expect(synthesis.speak.mock.calls[0][0].text).toBe('First answer.')
    await userEvent.click(within(first).getByRole('button', { name: 'Pause' }))
    expect(synthesis.pause).toHaveBeenCalled()
    expect(within(first).getByRole('button', { name: 'Resume' })).toBeInTheDocument()

    // Starting the second reply stops the first.
    await userEvent.click(within(second).getByRole('button', { name: 'Listen' }))
    expect(synthesis.cancel).toHaveBeenCalled()
    expect(within(first).getByRole('button', { name: 'Listen' })).toBeInTheDocument()
    await userEvent.click(within(second).getByRole('button', { name: 'Stop' }))
    expect(within(second).getByRole('button', { name: 'Listen' })).toBeInTheDocument()
  })

  it('offers no Listen button where the browser cannot speak', async () => {
    chat.mockResolvedValue(reply('Answer.'))
    render(<App />)
    await userEvent.type(field(), 'Hi{Enter}')
    await screen.findByText('Answer.')
    expect(screen.queryByRole('button', { name: 'Listen' })).toBeNull()
  })
})

describe('toSpeech', () => {
  it('turns math into words and drops formatting', () => {
    expect(toSpeech('**Distance** is $s = \\frac{1}{2}at^2$.')).toBe('Distance is s equals 1 over 2at squared.')
  })

  it('mentions code and plots instead of reading them', () => {
    const text = toSpeech('Look:\n\n```python\nprint(1)\n```\n\n```plot\n{}\n```')
    expect(text).toContain('A code example is shown on screen.')
    expect(text).toContain('A graph is shown on screen.')
    expect(text).not.toContain('print')
  })
})
