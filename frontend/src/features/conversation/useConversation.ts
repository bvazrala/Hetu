import { useEffect, useRef, useState } from 'react'
import { AnalyzeError, MAX_MESSAGE_CHARS, MAX_MESSAGES, sendChat } from '../../lib/api'
import { clearSession, loadSession, saveSession } from '../../lib/storage'
import type {
  LearningState,
  ProofContext,
  ProofInspection,
  Specialist,
  ToolCheck,
  WorkspaceContext,
} from '../../lib/types'

/** One message in the conversation, with what Hetu attached to its own replies. */
export interface Turn {
  id: number
  role: 'student' | 'hetu'
  content: string
  /** The workspace draft the student chose to send along with this message. */
  workspace?: WorkspaceContext
  specialists?: Specialist[]
  checks?: ToolCheck[]
  inspection?: ProofInspection | null
}

interface SavedSession {
  turns: Turn[]
  notes: LearningState | null
}

const SAVE_DELAY_MS = 400
// Older turns stay on screen for this visit but are not kept across reloads.
const MAX_SAVED_TURNS = 60

function restore(): SavedSession {
  const saved = loadSession()
  if (typeof saved !== 'object' || saved === null) return { turns: [], notes: null }
  const { turns, notes } = saved as Record<string, unknown>
  if (!Array.isArray(turns)) return { turns: [], notes: null }
  const usable = turns.filter(
    (turn): turn is Turn =>
      typeof turn === 'object' &&
      turn !== null &&
      typeof turn.id === 'number' &&
      typeof turn.content === 'string' &&
      (turn.role === 'student' || turn.role === 'hetu'),
  )
  return { turns: usable, notes: typeof notes === 'object' ? (notes as LearningState | null) : null }
}

/** The question still open from the latest proof inspection, if there is one. */
function openQuestion(turns: Turn[]): ProofContext | undefined {
  const latest = turns.findLast((turn) => turn.inspection)?.inspection
  const observation = latest?.analysis.observations.at(0)
  const step = latest?.analysis.nodes.find((node) => node.id === observation?.target)
  if (!latest || !observation || !step) return undefined
  return { problem: latest.problem, draft: latest.draft, step_text: step.text, question: observation.question }
}

/**
 * Holds one learning session: the turns, Hetu's notes about the session,
 * and the message being typed. The server keeps no session, so each request
 * carries the recent turns and the notes.
 */
export function useConversation() {
  const [saved] = useState(restore)
  const [turns, setTurns] = useState<Turn[]>(saved.turns)
  const [notes, setNotes] = useState<LearningState | null>(saved.notes)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Raised when a new session starts, so a reply to the old one is dropped.
  const session = useRef(0)
  const nextId = useRef(saved.turns.reduce((highest, turn) => Math.max(highest, turn.id), 0) + 1)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (turns.length === 0) clearSession()
      else saveSession({ turns: turns.slice(-MAX_SAVED_TURNS), notes } satisfies SavedSession)
    }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [turns, notes])

  async function request(history: Turn[]) {
    const id = session.current
    setBusy(true)
    setError(null)
    const last = history[history.length - 1]
    try {
      const response = await sendChat({
        messages: history
          .slice(-MAX_MESSAGES)
          .map((turn) => ({ role: turn.role, content: turn.content.slice(0, MAX_MESSAGE_CHARS) })),
        learning_state: notes,
        workspace: last.workspace,
        proof_context: openQuestion(history),
      })
      if (id !== session.current) return
      setTurns((current) => [
        ...current,
        {
          id: nextId.current++,
          role: 'hetu',
          content: response.reply,
          specialists: response.specialists,
          checks: response.checks,
          inspection: response.inspection,
        },
      ])
      setNotes(response.learning_state)
    } catch (caught) {
      if (id !== session.current) return
      setError(caught instanceof AnalyzeError ? caught.message : 'Hetu could not answer.')
    } finally {
      if (id === session.current) setBusy(false)
    }
  }

  /** Adds the student's message and asks Hetu for a reply. */
  function send(text: string, workspace?: WorkspaceContext) {
    const content = text.trim()
    if (busy || content === '') return
    const history = [...turns, { id: nextId.current++, role: 'student' as const, content, workspace }]
    setTurns(history)
    setInput('')
    void request(history)
  }

  /** Asks again for a reply to the last message, after a failure. */
  function retry() {
    if (busy || turns.at(-1)?.role !== 'student') return
    void request(turns)
  }

  function newSession() {
    session.current += 1
    setTurns([])
    setNotes(null)
    setInput('')
    setBusy(false)
    setError(null)
    clearSession()
  }

  return { turns, notes, input, setInput, busy, error, send, retry, newSession }
}

export type ConversationState = ReturnType<typeof useConversation>
