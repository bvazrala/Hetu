import { useEffect, useRef, useState } from 'react'
import { AnalyzeError, MAX_MESSAGE_CHARS, MAX_MESSAGES, sendChat } from '../../lib/api'
import { clearSession, loadSession } from '../../lib/storage'
import { titleFrom, type MessageMeta, type Store, type StoredMessage } from '../../lib/store'
import type {
  Assist,
  Intent,
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
  /** True for a saved message that was sent with the workspace. The draft itself is not saved again. */
  workspaceIncluded?: boolean
  /** The kind of help the student asked for with this message. */
  assist?: Assist
  /** What Hetu chose to do in this reply. */
  action?: string
  specialists?: Specialist[]
  checks?: ToolCheck[]
  inspection?: ProofInspection | null
}

/** The note lists a student can correct by removing an item. */
export type NoteList = 'concepts' | 'understood' | 'misconceptions' | 'open_questions'

export interface SendOptions {
  workspace?: WorkspaceContext
  assist?: Assist
}

/**
 * Where the conversation is kept.
 * - `off`: a guest conversation, kept in this tab only.
 * - `local`: a signed-in student chose not to save this one.
 * - `ask`: the student signed in during a guest conversation and has not chosen yet.
 * - the rest: saving to the account.
 */
export type SaveState = 'off' | 'local' | 'ask' | 'saving' | 'saved' | 'error'

interface SavedSession {
  turns: Turn[]
  notes: LearningState | null
  intent: Intent | null
}

/** How much of the current conversation is already in the account. */
interface Progress {
  conversationId: string | null
  saved: number
  notes: string
}

const SYNC_DELAY_MS = 300
const INTENTS: Intent[] = ['understand', 'solve', 'examine']

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Notes from storage or the server. Missing lists are empty. */
function normalizeNotes(value: unknown): LearningState | null {
  if (typeof value !== 'object' || value === null) return null
  const notes = value as Record<string, unknown>
  return {
    topic: typeof notes.topic === 'string' ? notes.topic : null,
    goal: typeof notes.goal === 'string' ? notes.goal : null,
    concepts: strings(notes.concepts),
    understood: strings(notes.understood),
    misconceptions: strings(notes.misconceptions),
    open_questions: strings(notes.open_questions),
    dismissed: strings(notes.dismissed),
  }
}

function usableTurns(value: unknown): Turn[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (turn): turn is Turn =>
      typeof turn === 'object' &&
      turn !== null &&
      typeof turn.id === 'number' &&
      typeof turn.content === 'string' &&
      (turn.role === 'student' || turn.role === 'hetu'),
  )
}

/**
 * A conversation that an earlier version of Hetu kept in this browser.
 * Guest conversations are no longer kept, but this one is not deleted
 * until the student says so.
 */
function readLegacy(): SavedSession | null {
  const saved = loadSession()
  if (typeof saved !== 'object' || saved === null) return null
  const { turns, notes, intent } = saved as Record<string, unknown>
  const usable = usableTurns(turns)
  if (usable.length === 0) return null
  return {
    turns: usable,
    notes: normalizeNotes(notes),
    intent: INTENTS.includes(intent as Intent) ? (intent as Intent) : null,
  }
}

/** The question still open from the latest proof inspection, if there is one. */
function openQuestion(turns: Turn[]): ProofContext | undefined {
  const latest = turns.findLast((turn) => turn.inspection)?.inspection
  const observation = latest?.analysis.observations.at(0)
  const step = latest?.analysis.nodes.find((node) => node.id === observation?.target)
  if (!latest || !observation || !step) return undefined
  return { problem: latest.problem, draft: latest.draft, step_text: step.text, question: observation.question }
}

function toStored(turn: Turn): StoredMessage {
  const meta: MessageMeta = {}
  if (turn.assist) meta.assist = turn.assist
  if (turn.workspace || turn.workspaceIncluded) meta.workspaceIncluded = true
  if (turn.action) meta.action = turn.action
  if (turn.specialists?.length) meta.specialists = turn.specialists
  if (turn.checks?.length) meta.checks = turn.checks
  if (turn.inspection) meta.inspection = turn.inspection
  return { role: turn.role, content: turn.content, meta: Object.keys(meta).length > 0 ? meta : null }
}

function fromStored(message: StoredMessage, id: number): Turn {
  const meta = message.meta ?? {}
  return {
    id,
    role: message.role,
    content: message.content,
    assist: meta.assist,
    workspaceIncluded: meta.workspaceIncluded,
    action: meta.action,
    specialists: meta.specialists,
    checks: meta.checks,
    inspection: meta.inspection ?? null,
  }
}

/**
 * Holds one learning session: the turns, Hetu's notes about the session,
 * and the message being typed. The API keeps no session, so each request
 * carries the recent turns and the notes.
 *
 * For a guest, the session lives in this tab only. For a signed-in student,
 * `store` is set and each message is saved to their account as it happens.
 */
export function useConversation(store: Store | null = null) {
  const [legacy, setLegacy] = useState<SavedSession | null>(readLegacy)
  const [turns, setTurns] = useState<Turn[]>([])
  const [notes, setNotes] = useState<LearningState | null>(null)
  const [intent, setIntent] = useState<Intent | null>(null)
  const [input, setInput] = useState('')
  const [assist, setAssist] = useState<Assist | null>(null)
  const [attachWorkspace, setAttachWorkspace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>(store ? 'saved' : 'off')
  const [loading, setLoading] = useState(false)
  /** Increases whenever something asks for the cursor to go to the composer. */
  const [composerFocus, setComposerFocus] = useState(0)

  // Raised when a new session starts, so a reply or a save for the old one is dropped.
  const session = useRef(0)
  const nextId = useRef(1)
  const progress = useRef<Progress>({ conversationId: null, saved: 0, notes: 'null' })
  const queue = useRef<Promise<void>>(Promise.resolve())
  // Async work reads the newest values through these.
  const latest = useRef({ turns, notes, intent, store })
  useEffect(() => {
    latest.current = { turns, notes, intent, store }
  })

  function reset(state: SaveState) {
    session.current += 1
    progress.current = { conversationId: null, saved: 0, notes: 'null' }
    setTurns([])
    setNotes(null)
    setIntent(null)
    setInput('')
    setAssist(null)
    setAttachWorkspace(false)
    setBusy(false)
    setError(null)
    setConversationId(null)
    setSaveState(state)
  }

  // Signing in or out changes where the session belongs.
  const signedIn = store !== null
  const previouslySignedIn = useRef(signedIn)
  useEffect(() => {
    if (previouslySignedIn.current === signedIn) return
    previouslySignedIn.current = signedIn
    if (!signedIn) {
      // After sign-out, nothing from the account stays on screen.
      reset('off')
    } else if (latest.current.turns.length > 0) {
      // Guest work is never moved into an account without asking.
      setSaveState('ask')
    } else {
      setSaveState('saved')
    }
  }, [signedIn])

  /** Saves whatever the account does not have yet: the conversation, new messages, changed notes. */
  async function syncNow() {
    const current = session.current
    const target = progress.current
    const { turns: all, notes: currentNotes, intent: currentIntent, store: currentStore } = latest.current
    if (!currentStore || all.length === 0) return
    const notesJson = JSON.stringify(currentNotes)
    if (target.saved >= all.length && target.notes === notesJson) return

    setSaveState('saving')
    try {
      if (!target.conversationId) {
        const first = all.find((turn) => turn.role === 'student') ?? all[0]
        target.conversationId = await currentStore.createConversation(titleFrom(first.content), currentIntent)
        if (current === session.current) setConversationId(target.conversationId)
      }
      while (target.saved < all.length) {
        await currentStore.appendMessage(target.conversationId, toStored(all[target.saved]))
        target.saved += 1
      }
      if (currentNotes && target.notes !== notesJson) {
        await currentStore.saveNotes(target.conversationId, currentNotes)
        target.notes = notesJson
      }
      if (current === session.current) setSaveState('saved')
    } catch {
      // The work stays on screen. The next change, or Try saving again, picks up where this stopped.
      if (current === session.current) setSaveState('error')
    }
  }

  function enqueueSync() {
    queue.current = queue.current.then(syncNow)
  }

  const syncing = store !== null && (saveState === 'saving' || saveState === 'saved' || saveState === 'error')
  useEffect(() => {
    if (!syncing || turns.length === 0) return
    const timer = setTimeout(enqueueSync, SYNC_DELAY_MS)
    return () => clearTimeout(timer)
    // enqueueSync reads everything it needs through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncing, turns, notes])

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
        learning_state: latest.current.notes,
        workspace: last.workspace,
        proof_context: openQuestion(history),
        assist: last.assist,
        intent: latest.current.intent ?? undefined,
      })
      if (id !== session.current) return
      setTurns((current) => [
        ...current,
        {
          id: nextId.current++,
          role: 'hetu',
          content: response.reply,
          action: response.action,
          specialists: response.specialists,
          checks: response.checks,
          inspection: response.inspection,
        },
      ])
      setNotes((current) => withRemovals(normalizeNotes(response.learning_state), current))
    } catch (caught) {
      if (id !== session.current) return
      setError(caught instanceof AnalyzeError ? caught.message : 'Hetu could not answer.')
    } finally {
      if (id === session.current) setBusy(false)
    }
  }

  /**
   * Adds the student's message and asks Hetu for a reply. The kind of help
   * selected in the composer applies to this one message only.
   */
  function send(text: string, options: SendOptions = {}) {
    const content = text.trim()
    if (busy || loading || content === '') return
    const chosen = options.assist ?? assist ?? undefined
    const history = [
      ...turns,
      { id: nextId.current++, role: 'student' as const, content, workspace: options.workspace, assist: chosen },
    ]
    setTurns(history)
    setInput('')
    setAssist(null)
    setAttachWorkspace(false)
    void request(history)
  }

  /** Asks again for a reply to the last message, after a failure. */
  function retry() {
    if (busy || turns.at(-1)?.role !== 'student') return
    void request(turns)
  }

  /**
   * Puts text into the composer for the student to finish, and moves the
   * cursor there. Used when the student asks about part of their work.
   */
  function compose(text: string, options: { attachWorkspace?: boolean } = {}) {
    setInput((current) => (current.trim() === '' ? text : `${current.trimEnd()}\n\n${text}`))
    if (options.attachWorkspace) setAttachWorkspace(true)
    setComposerFocus((count) => count + 1)
  }

  /** Removes one note. Hetu is told about the removal and does not add it back. */
  function removeNote(list: NoteList, item: string) {
    setNotes((current) => {
      if (!current) return current
      return {
        ...current,
        [list]: current[list].filter((note) => note !== item),
        dismissed: [...current.dismissed.filter((note) => note !== item), item],
      }
    })
  }

  function chooseIntent(next: Intent | null) {
    setIntent(next)
    setComposerFocus((count) => count + 1)
  }

  function newSession() {
    reset(store ? 'saved' : 'off')
  }

  /** Opens a saved conversation from the account. */
  async function open(id: string) {
    if (!store) return
    reset('saved')
    const current = session.current
    setLoading(true)
    try {
      const saved = await store.loadConversation(id)
      if (current !== session.current) return
      const restored = saved.messages.map((message) => fromStored(message, nextId.current++))
      const restoredNotes = normalizeNotes(saved.notes)
      progress.current = { conversationId: id, saved: restored.length, notes: JSON.stringify(restoredNotes) }
      setTurns(restored)
      setNotes(restoredNotes)
      setIntent(saved.intent)
      setConversationId(id)
    } catch {
      if (current === session.current) setError('This conversation could not be opened. Try again in a moment.')
    } finally {
      if (current === session.current) setLoading(false)
    }
  }

  /** The student agreed to save the conversation they had as a guest. */
  function saveToAccount() {
    if (store) setSaveState('saved')
  }

  /** The student chose to keep this conversation out of their account. */
  function keepLocal() {
    setSaveState('local')
  }

  function retrySave() {
    enqueueSync()
  }

  /** Brings the conversation from an earlier version into this tab. */
  function openLegacy() {
    if (!legacy) return
    reset(store ? 'saved' : 'off')
    setTurns(legacy.turns.map((turn) => ({ ...turn, id: nextId.current++ })))
    setNotes(legacy.notes)
    setIntent(legacy.intent)
    // Once it is in an account it is safe to drop from the browser. A guest keeps the copy.
    if (store) clearSession()
    setLegacy(null)
  }

  function discardLegacy() {
    clearSession()
    setLegacy(null)
  }

  return {
    turns,
    notes,
    intent,
    input,
    setInput,
    assist,
    setAssist,
    attachWorkspace,
    setAttachWorkspace,
    busy,
    loading,
    error,
    composerFocus,
    conversationId,
    saveState,
    hasLegacy: legacy !== null,
    send,
    retry,
    compose,
    removeNote,
    chooseIntent,
    newSession,
    open,
    saveToAccount,
    keepLocal,
    retrySave,
    openLegacy,
    discardLegacy,
  }
}

/** Applies removals the student made while a reply was on its way. */
function withRemovals(next: LearningState | null, current: LearningState | null): LearningState | null {
  if (!next || !current || current.dismissed.length === 0) return next
  const removed = new Set(current.dismissed.map((note) => note.toLowerCase()))
  const keep = (notes: string[]) => notes.filter((note) => !removed.has(note.toLowerCase()))
  return {
    ...next,
    concepts: keep(next.concepts),
    understood: keep(next.understood),
    misconceptions: keep(next.misconceptions),
    open_questions: keep(next.open_questions),
    dismissed: [...new Set([...next.dismissed, ...current.dismissed])],
  }
}

export type ConversationState = ReturnType<typeof useConversation>
