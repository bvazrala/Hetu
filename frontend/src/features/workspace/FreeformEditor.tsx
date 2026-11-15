import { useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import { MAX_DRAFT_CHARS, MAX_PROBLEM_CHARS } from '../../lib/api'
import type { FocusRequest } from './useWorkspace'

interface Props {
  problem: string
  draft: string
  busy: boolean
  error: string | null
  notice: string | null
  focusRequest: FocusRequest | null
  /** Where the draft is kept, in a few words. */
  saveLabel?: string
  onProblemChange: (value: string) => void
  onDraftChange: (value: string) => void
  onLoadExample: () => void
  /** Maps the draft into steps and opens the Structure view. */
  onInspect: () => void
  /** Sends the whole draft into the conversation for feedback. */
  onDiscuss: () => void
  /** Quotes part of the draft in the composer, for the student to ask about. */
  onAskAbout: (text: string) => void
  onReset: () => void
}

/**
 * A place for longer work than fits in a chat message: proofs, solutions,
 * essays, notes. Everything here stays in the workspace until the student
 * chooses to share it.
 */
export function FreeformEditor({
  problem,
  draft,
  busy,
  error,
  notice,
  focusRequest,
  saveLabel = 'Not saved. Stays in this tab.',
  onProblemChange,
  onDraftChange,
  onLoadExample,
  onInspect,
  onDiscuss,
  onAskAbout,
  onReset,
}: Props) {
  const draftField = useRef<HTMLTextAreaElement>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [selection, setSelection] = useState('')

  const hasDraft = draft.trim().length > 0
  const hasWork = problem !== '' || draft !== ''

  useEffect(() => {
    const field = draftField.current
    if (!focusRequest || !field) return
    field.focus()
    if (focusRequest.range) {
      field.setSelectionRange(focusRequest.range.start, focusRequest.range.end)
      setSelection(field.value.slice(focusRequest.range.start, focusRequest.range.end).trim())
    }
  }, [focusRequest])

  function trackSelection(event: SyntheticEvent<HTMLTextAreaElement>) {
    const { selectionStart, selectionEnd, value } = event.currentTarget
    setSelection(value.slice(selectionStart, selectionEnd).trim())
  }

  function inspectOnShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && hasDraft && !busy) {
      event.preventDefault()
      onInspect()
    }
  }

  return (
    <div className="space-y-5" aria-busy={busy}>
      <div>
        <label htmlFor="problem" className="mb-1.5 block text-sm font-medium text-muted">
          Problem or goal
        </label>
        <textarea
          id="problem"
          rows={2}
          maxLength={MAX_PROBLEM_CHARS}
          value={problem}
          onChange={(e) => onProblemChange(e.target.value)}
          onKeyDown={inspectOnShortcut}
          placeholder="What are you trying to show, solve, or argue?"
          className="field resize-y"
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-4">
          <label htmlFor="draft" className="block text-sm font-medium text-muted">
            Your work
          </label>
          <span aria-live="polite" className="text-xs text-muted">
            {saveLabel}
          </span>
        </div>
        <textarea
          id="draft"
          ref={draftField}
          rows={10}
          maxLength={MAX_DRAFT_CHARS}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onSelect={trackSelection}
          onKeyDown={inspectOnShortcut}
          placeholder="Write it your way. Rough steps are fine."
          aria-describedby="draft-help"
          className="field min-h-56 resize-y"
        />
        <div className="mt-2 flex min-h-8 flex-wrap items-center gap-3">
          <p id="draft-help" className="text-xs text-muted">
            Select part of your work to ask Hetu about just that part.
          </p>
          {selection !== '' && (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => onAskAbout(selection)}>
              Ask about the selection
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onDiscuss} disabled={!hasDraft || busy} className="btn btn-primary">
          Get feedback
        </button>
        <button
          type="button"
          onClick={onInspect}
          disabled={!hasDraft || busy}
          aria-describedby="inspect-note"
          aria-keyshortcuts="Control+Enter Meta+Enter"
          className="btn btn-secondary"
        >
          {busy ? 'Mapping the steps…' : 'Map the steps'}
        </button>

        <div className="ml-auto flex flex-wrap items-center">
          {confirmingReset ? (
            <span className="flex flex-wrap items-center gap-1 text-sm">
              <span className="text-muted">Clear the problem and your work?</span>
              <button
                type="button"
                className="btn btn-quiet btn-small text-ink"
                onClick={() => {
                  setConfirmingReset(false)
                  onReset()
                }}
              >
                Yes, clear
              </button>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setConfirmingReset(false)}>
                Keep
              </button>
            </span>
          ) : (
            <>
              <button type="button" onClick={onLoadExample} disabled={busy} className="btn btn-quiet btn-small">
                Try an example
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-small"
                disabled={!hasWork}
                onClick={() => setConfirmingReset(true)}
              >
                Clear workspace
              </button>
            </>
          )}
        </div>
      </div>

      {/* One live region, so screen readers hear each change of state. */}
      <div id="inspect-note" aria-live="polite" className="min-h-10 text-sm">
        {busy ? (
          <p className="text-muted">Reading your work. This usually takes a few seconds.</p>
        ) : error ? (
          <p className="border-l-2 border-flag pl-3">
            <span className="font-medium">{error}</span>{' '}
            <span className="text-muted">Your work is unchanged. You can try again.</span>
          </p>
        ) : notice ? (
          <p className="border-l-2 border-flag pl-3">{notice}</p>
        ) : (
          <p className="text-muted">
            Get feedback sends your work to the conversation. Map the steps lays out a proof or derivation step by
            step, so you can see what each step relies on. Shortcut: Ctrl or ⌘ with Enter.
          </p>
        )}
      </div>
    </div>
  )
}
