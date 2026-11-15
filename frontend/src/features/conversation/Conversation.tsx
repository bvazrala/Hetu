import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { BackendStatus } from '../../components/BackendStatus'
import { Markdown } from '../../components/Markdown'
import { MAX_MESSAGE_CHARS } from '../../lib/api'
import { graphIsUseful } from '../../lib/graph'
import type { Assist, ProofInspection, Specialist, WorkspaceContext } from '../../lib/types'
import { SessionNotes } from './SessionNotes'
import type { ConversationState, Turn } from './useConversation'
import { STARTS } from './starts'
import { Welcome } from './Welcome'

interface Props {
  conversation: ConversationState
  /** The workspace draft, offered to the student as something they can include. */
  workspace: WorkspaceContext | null
  /** Opens a proof inspection from the conversation in the workspace. */
  onOpenInspection: (inspection: ProofInspection) => void
  onOpenWorkspace: () => void
  /** Messages about saving and accounts, shown above the conversation. */
  notices?: ReactNode[]
  /** Where this conversation is kept, in a few words. */
  saveNote?: string
}

const SPECIALIST_LABELS: Record<Specialist, string> = {
  mathematics: 'Mathematics',
  science: 'Science',
  programming: 'Programming',
  humanities: 'Writing and humanities',
  logic: 'Logic',
}

/** The kinds of help a student can ask for, in the order the composer lists them. */
const ASSIST_OPTIONS: { value: Assist; label: string; note: string }[] = [
  { value: 'explain', label: 'Explain this', note: 'Asked for an explanation' },
  { value: 'hint', label: 'Give me a hint', note: 'Asked for a hint' },
  { value: 'check', label: 'Check my reasoning', note: 'Asked for a check of your reasoning' },
  { value: 'example', label: 'Show an example', note: 'Asked for an example' },
  { value: 'try', label: 'Let me try', note: 'Wanted to try it yourself' },
  { value: 'challenge', label: 'Challenge my assumption', note: 'Asked to be challenged' },
]

// One-tap follow-ups under Hetu's latest reply. Each sends a short message the student can see.
const FOLLOW_UPS: Partial<Record<Assist, string>> = {
  example: 'Show me an example.',
  try: "I'd like to try it myself.",
  hint: 'Can I have a hint?',
  explain: 'Can you explain that a different way?',
}

/** Two follow-ups that fit what Hetu just did, so the options stay few. */
function followUpsFor(action: string | undefined): Assist[] {
  switch (action) {
    case 'demonstrate':
      return ['try', 'explain']
    case 'give_hint':
    case 'let_student_try':
    case 'practice':
    case 'check_understanding':
    case 'inspect_reasoning':
    case 'challenge_assumption':
      return ['hint', 'explain']
    case 'teach':
    case 'explain':
    case 'explore':
    case 'answer_directly':
    case 'correct_misconception':
    case 'reconsider':
      return ['example', 'try']
    default:
      return []
  }
}

export function Conversation({ conversation, workspace, onOpenInspection, onOpenWorkspace, notices = [], saveNote }: Props) {
  const { turns, notes, intent, input, setInput, assist, setAssist, busy, error, loading } = conversation
  const end = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)

  // Keep the newest message in view. scrollIntoView is missing in some test environments.
  useEffect(() => {
    if (turns.length > 0 || busy) end.current?.scrollIntoView?.({ block: 'end' })
  }, [turns.length, busy])

  // Something outside the composer asked for the cursor, such as "Ask about the selection".
  useEffect(() => {
    const element = field.current
    if (conversation.composerFocus === 0 || !element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [conversation.composerFocus])

  function submit() {
    if (busy || input.trim() === '') return
    conversation.send(input, { workspace: conversation.attachWorkspace && workspace ? workspace : undefined })
  }

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends and Shift+Enter adds a line. An Enter that confirms an
    // input method composition, as in Japanese or Chinese, must not send.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  const latest = turns.at(-1)
  const followUps = !busy && !error && latest?.role === 'hetu' ? followUpsFor(latest.action) : []
  const placeholder = STARTS.find((start) => start.intent === intent)?.placeholder ?? 'Ask a question, or share what you are working on'

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-5 pt-6 pb-8 sm:px-8">
          {loading ? (
            <p aria-live="polite" className="py-10 text-muted">
              Opening the conversation…
            </p>
          ) : turns.length === 0 && error ? (
            <p role="alert" className="border-l-2 border-flag py-2 pl-3">
              {error}
            </p>
          ) : turns.length === 0 ? (
            <Welcome intent={intent} onChoose={conversation.chooseIntent} onOpenWorkspace={onOpenWorkspace} />
          ) : (
            <>
              <h2 className="sr-only">Conversation</h2>
              <div className="mb-6">
                <SessionNotes notes={notes} onRemove={conversation.removeNote} />
              </div>

              <div role="log" aria-label="Conversation" className="space-y-8">
                {turns.map((turn) => (
                  <Message key={turn.id} turn={turn} workspace={workspace} onOpenInspection={onOpenInspection} />
                ))}
              </div>

              {followUps.length > 0 && (
                <div role="group" aria-label="Next step" className="mt-5 flex flex-wrap gap-2">
                  {followUps.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className="btn btn-secondary btn-small rounded-full"
                      onClick={() => conversation.send(FOLLOW_UPS[kind]!, { assist: kind })}
                    >
                      {ASSIST_OPTIONS.find((option) => option.value === kind)!.label}
                    </button>
                  ))}
                </div>
              )}

              <div aria-live="polite" className="mt-6 min-h-6 text-sm">
                {busy && (
                  <p className="flex items-center gap-2 text-muted">
                    <span aria-hidden="true" className="size-2 rounded-full bg-accent motion-safe:animate-pulse" />
                    Hetu is thinking…
                  </p>
                )}
                {error && !busy && (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border border-flag/40 bg-flag-soft px-4 py-3">
                    <p>
                      <span className="font-medium">{error}</span>{' '}
                      <span className="text-muted">Your message is still here.</span>
                    </p>
                    <button type="button" className="btn btn-secondary btn-small" onClick={conversation.retry}>
                      Try again
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          <div ref={end} />
        </div>
      </div>

      <div className="border-t border-rule bg-paper">
        {/* Notices sit by the composer, so they are seen however far the conversation has scrolled. */}
        {notices.length > 0 && (
          <div className="mx-auto max-h-[40vh] w-full max-w-3xl space-y-2 overflow-y-auto px-5 pt-3 sm:px-8">{notices}</div>
        )}
        <form
          className="mx-auto w-full max-w-3xl px-5 pt-3 pb-3 sm:px-8"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <label htmlFor="message" className="sr-only">
            Message Hetu
          </label>
          <div className="rounded-lg border border-rule bg-surface transition-colors focus-within:border-accent focus-within:shadow-[0_0_0_1px_var(--color-accent)]">
            <textarea
              id="message"
              ref={field}
              rows={2}
              maxLength={MAX_MESSAGE_CHARS}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={submitOnEnter}
              placeholder={placeholder}
              aria-describedby="message-hint"
              className="block max-h-60 min-h-14 w-full [field-sizing:content] resize-none bg-transparent px-4 pt-3 pb-1 font-serif text-lg leading-relaxed outline-none placeholder:text-muted focus-visible:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
              <label className="flex items-center gap-1.5 rounded-md px-2 text-sm text-muted">
                <span>Help</span>
                <select
                  value={assist ?? ''}
                  onChange={(event) => setAssist((event.target.value || null) as Assist | null)}
                  className="rounded-md border border-rule bg-paper py-1 pr-1 pl-2 text-sm text-ink"
                >
                  <option value="">Let Hetu decide</option>
                  {ASSIST_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {workspace && (
                <label className="flex items-center gap-2 px-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={conversation.attachWorkspace}
                    onChange={(event) => conversation.setAttachWorkspace(event.target.checked)}
                    className="size-4 accent-accent"
                  />
                  Include my workspace
                </label>
              )}
              <button type="submit" disabled={busy || loading || input.trim() === ''} className="btn btn-primary ml-auto">
                Send
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted">
            <span id="message-hint">Enter to send. Shift with Enter for a new line.</span>
            <span className="flex flex-wrap items-center gap-x-3">
              {saveNote && <span>{saveNote}</span>}
              <span>Hetu can be wrong.</span>
              <BackendStatus />
            </span>
          </div>
        </form>
      </div>
    </div>
  )
}

/** The student's words as typed. Lines starting with "> " are shown as a quotation of their work. */
function StudentText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let quote: string[] = []
  let plain: string[] = []
  const flush = () => {
    if (quote.length > 0) {
      blocks.push(
        <blockquote key={blocks.length} className="border-l-2 border-rule pl-3 text-muted">
          {quote.join('\n')}
        </blockquote>,
      )
      quote = []
    }
    if (plain.length > 0) {
      blocks.push(<p key={blocks.length}>{plain.join('\n').trim()}</p>)
      plain = []
    }
  }
  for (const line of text.split('\n')) {
    const quoted = line.startsWith('> ') || line === '>'
    if (quoted !== quote.length > 0 && (quote.length > 0 || plain.length > 0)) flush()
    if (quoted) quote.push(line.slice(2))
    else plain.push(line)
  }
  flush()
  return <div className="mt-1 space-y-2 font-serif text-lg leading-relaxed whitespace-pre-wrap">{blocks}</div>
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
    const asked = ASSIST_OPTIONS.find((option) => option.value === turn.assist)
    return (
      <article aria-label="You said" className="ml-auto w-fit max-w-[92%] rounded-lg border border-rule bg-surface px-4 py-3 sm:max-w-[85%]">
        <h3 className="eyebrow">You</h3>
        <StudentText text={turn.content} />
        {(asked || turn.workspace || turn.workspaceIncluded) && (
          <p className="mt-2 text-xs text-muted">
            {[asked?.note, (turn.workspace || turn.workspaceIncluded) && 'Workspace included']
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </article>
    )
  }

  const specialists = (turn.specialists ?? []).map((name) => SPECIALIST_LABELS[name]).filter(Boolean)
  return (
    <article aria-label="Hetu said">
      <h3 className="eyebrow mb-1 text-accent">Hetu</h3>
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

      {turn.inspection && <InspectionCard inspection={turn.inspection} workspace={workspace} onOpen={onOpenInspection} />}

      {specialists.length > 0 && <p className="mt-3 text-xs text-muted">{specialists.join(' · ')}</p>}
    </article>
  )
}

/** Offers the step by step view for a proof that Hetu inspected in the conversation. */
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
  const label = graphIsUseful(inspection.analysis) ? 'Open reasoning graph' : 'Open the steps'
  // Opening the steps puts this proof into the workspace. Other work there is never replaced silently.
  const wouldReplace = workspace !== null && workspace.draft !== inspection.draft

  return (
    <div className="mt-4 rounded-md border border-rule bg-surface px-4 py-3 text-sm">
      <p>
        <span className="font-medium">Your argument, step by step.</span>{' '}
        <span className="text-muted">
          {steps} {steps === 1 ? 'step' : 'steps'}, {questions === 0 ? 'no question' : 'one question'}. See how the
          steps connect, revise a step, or challenge the question.
        </span>
      </p>
      {confirming ? (
        <p className="mt-3 flex flex-wrap items-center gap-3">
          <span>This replaces the text in your workspace.</span>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => onOpen(inspection)}>
            Replace and open
          </button>
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </p>
      ) : (
        <button
          type="button"
          className="btn btn-secondary btn-small mt-3"
          onClick={() => (wouldReplace ? setConfirming(true) : onOpen(inspection))}
        >
          {label}
        </button>
      )}
    </div>
  )
}
