import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Markdown } from '../../components/Markdown'
import { MAX_MESSAGE_CHARS } from '../../lib/api'
import type { LearningState, ProofInspection, Specialist, WorkspaceContext } from '../../lib/types'
import type { ConversationState, Turn } from './useConversation'

interface Props {
  conversation: ConversationState
  /** The workspace draft, offered to the student as something they can share. */
  workspace: WorkspaceContext | null
  /** Opens a proof inspection from the conversation in the Structured view. */
  onOpenInspection: (inspection: ProofInspection) => void
}

// One starter per kind of help, so a first visit shows the range without a tour.
const STARTERS = [
  "I don't understand inheritance in Python.",
  'Why does the sky look blue?',
  'Can you help me understand integration?',
  'Here is my proof that if n² is even, then n is even: Assume n² = 2k. Then n = √(2k), so n is even. Is my reasoning correct?',
  'Everyone I know who studies with music gets better grades, so studying with music makes everyone perform better.',
  "I'm writing about whether the Industrial Revolution improved people's lives. I think it did, but I'm not sure how to support that.",
]

const SPECIALIST_LABELS: Record<Specialist, string> = {
  mathematics: 'Mathematics',
  science: 'Science',
  programming: 'Programming',
  humanities: 'Writing and humanities',
  logic: 'Logic',
}

const outlineButton =
  'rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent-soft ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

export function Conversation({ conversation, workspace, onOpenInspection }: Props) {
  const { turns, notes, input, setInput, busy, error, send, retry, newSession } = conversation
  const [shareWorkspace, setShareWorkspace] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)

  // Keep the newest message in view. scrollIntoView is missing in some test environments.
  useEffect(() => {
    if (turns.length > 0 || busy) end.current?.scrollIntoView?.({ block: 'end' })
  }, [turns.length, busy])

  function submit() {
    if (busy || input.trim() === '') return
    send(input, shareWorkspace && workspace ? workspace : undefined)
    setShareWorkspace(false)
  }

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends and Shift+Enter adds a line. An Enter that confirms an
    // input method composition, as in Japanese or Chinese, must not send.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      {turns.length === 0 ? (
        <div className="flex-1 py-6">
          <h2 className="font-serif text-3xl leading-tight font-semibold">What are you trying to understand?</h2>
          <p className="mt-3 max-w-xl text-muted">
            Ask about any subject, or bring your own reasoning. Hetu explains, shows examples, and questions an
            argument when that is what helps.
          </p>
          <h3 className="mt-8 mb-3 text-sm font-medium text-muted">Or start from one of these</h3>
          <ul role="list" className="grid gap-3 sm:grid-cols-2">
            {STARTERS.map((starter) => (
              <li key={starter}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => send(starter)}
                  className="h-full w-full rounded-md border border-rule bg-surface px-4 py-3 text-left font-serif leading-snug transition-colors hover:border-accent disabled:opacity-50"
                >
                  {starter}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex-1">
          <h2 className="sr-only">Conversation</h2>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <SessionNotes notes={notes} />
            <button type="button" className={outlineButton + ' ml-auto'} onClick={newSession}>
              New session
            </button>
          </div>

          <div role="log" aria-label="Conversation" className="space-y-7">
            {turns.map((turn) => (
              <Message
                key={turn.id}
                turn={turn}
                workspace={workspace}
                onOpenInspection={onOpenInspection}
              />
            ))}
          </div>

          <div aria-live="polite" className="mt-6 min-h-6 text-sm">
            {busy && <p className="text-muted">Hetu is thinking…</p>}
            {error && !busy && (
              <p className="flex flex-wrap items-center gap-3 border-l-2 border-flag pl-3">
                <span>
                  <span className="font-medium">{error}</span>{' '}
                  <span className="text-muted">Your message is still here.</span>
                </span>
                <button type="button" className={outlineButton} onClick={retry}>
                  Try again
                </button>
              </p>
            )}
          </div>
        </div>
      )}

      <div ref={end} />

      <form
        className="sticky bottom-0 -mx-1 mt-6 border-t border-rule bg-paper px-1 pt-4 pb-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label htmlFor="message" className="sr-only">
          Message Hetu
        </label>
        <div className="flex items-end gap-3">
          <textarea
            id="message"
            ref={field}
            rows={2}
            maxLength={MAX_MESSAGE_CHARS}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={submitOnEnter}
            placeholder="Ask a question, or share what you are working on"
            aria-describedby="message-hint"
            className="max-h-60 min-h-14 w-full [field-sizing:content] resize-none rounded-md border border-rule bg-surface px-4 py-3 font-serif text-lg leading-relaxed placeholder:text-muted focus-visible:border-accent"
          />
          <button
            type="submit"
            disabled={busy || input.trim() === ''}
            className="rounded-md bg-accent px-5 py-3 font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-rule disabled:text-muted"
          >
            Send
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted">
          <span id="message-hint">Enter to send. Shift with Enter for a new line.</span>
          {workspace && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={shareWorkspace}
                onChange={(event) => setShareWorkspace(event.target.checked)}
                className="accent-accent"
              />
              Share my workspace draft with this message
            </label>
          )}
        </div>
      </form>
    </div>
  )
}

function Message({
  turn,
  workspace,
  onOpenInspection,
}: {
  turn: Turn
  workspace: WorkspaceContext | null
  onOpenInspection: (inspection: ProofInspection) => void
}) {
  if (turn.role === 'student') {
    return (
      <article aria-label="You said" className="rounded-md border border-rule bg-surface px-4 py-3">
        <h3 className="text-xs font-medium tracking-wide text-muted uppercase">You</h3>
        <p className="mt-1 font-serif text-lg leading-relaxed whitespace-pre-wrap">{turn.content}</p>
        {turn.workspace && <p className="mt-2 text-xs text-muted">Sent with your workspace draft.</p>}
      </article>
    )
  }

  const specialists = (turn.specialists ?? []).map((name) => SPECIALIST_LABELS[name]).filter(Boolean)
  return (
    <article aria-label="Hetu said" className="px-1">
      <h3 className="mb-1 text-xs font-medium tracking-wide text-accent uppercase">Hetu</h3>
      <Markdown text={turn.content} />

      {(turn.checks ?? []).length > 0 && (
        <div className="mt-4 rounded-md border border-rule bg-surface px-4 py-3 text-sm">
          <p className="font-medium">Checked by computation</p>
          <ul className="mt-1 space-y-1 text-muted">
            {turn.checks!.map((check, index) => (
              <li key={index}>{check.result}</li>
            ))}
          </ul>
        </div>
      )}

      {turn.inspection && (
        <InspectionCard inspection={turn.inspection} workspace={workspace} onOpen={onOpenInspection} />
      )}

      {specialists.length > 0 && <p className="mt-3 text-xs text-muted">{specialists.join(' · ')}</p>}
    </article>
  )
}

/** Offers the reasoning graph for a proof that Hetu inspected in the conversation. */
function InspectionCard({
  inspection,
  workspace,
  onOpen,
}: {
  inspection: ProofInspection
  workspace: WorkspaceContext | null
  onOpen: (inspection: ProofInspection) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const steps = inspection.analysis.nodes.length
  const questions = inspection.analysis.observations.length
  // Opening the graph puts this proof into the workspace. Other work there is never replaced silently.
  const wouldReplace = workspace !== null && workspace.draft !== inspection.draft

  return (
    <div className="mt-4 rounded-md border border-rule bg-surface px-4 py-3 text-sm">
      <p>
        <span className="font-medium">Reasoning graph.</span>{' '}
        <span className="text-muted">
          {steps} {steps === 1 ? 'step' : 'steps'}, {questions === 0 ? 'no question' : 'one question'}. See how the
          steps connect, revise a step, or challenge the question.
        </span>
      </p>
      {confirming ? (
        <p className="mt-3 flex flex-wrap items-center gap-3">
          <span>This replaces the text in your workspace.</span>
          <button type="button" className={outlineButton} onClick={() => onOpen(inspection)}>
            Replace and open
          </button>
          <button type="button" className={outlineButton} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </p>
      ) : (
        <button
          type="button"
          className={outlineButton + ' mt-3'}
          onClick={() => (wouldReplace ? setConfirming(true) : onOpen(inspection))}
        >
          Open reasoning graph
        </button>
      )}
    </div>
  )
}

/** Hetu's running notes on the session, shown so the student can see and judge them. */
function SessionNotes({ notes }: { notes: LearningState | null }) {
  if (!notes) return null
  const rows: [string, string][] = [
    ['Topic', notes.topic ?? ''],
    ['Goal', notes.goal ?? ''],
    ['Covered so far', notes.concepts.join(', ')],
    ['You have shown', notes.understood.join(', ')],
    ['Possible mix-ups', notes.misconceptions.join(', ')],
  ]
  const filled = rows.filter(([, value]) => value !== '')
  if (filled.length === 0) return null

  return (
    <details className="max-w-xl text-sm">
      <summary className="w-fit cursor-pointer font-medium text-muted">Session notes</summary>
      <dl className="mt-2 space-y-1">
        {filled.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="shrink-0 font-medium">{label}:</dt>
            <dd className="text-muted">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">
        Hetu keeps these rough notes to follow the conversation. They are guesses from this session, not a measure
        of what you know.
      </p>
    </details>
  )
}
