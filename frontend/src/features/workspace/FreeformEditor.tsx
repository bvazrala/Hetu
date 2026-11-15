import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { MAX_DRAFT_CHARS, MAX_PROBLEM_CHARS } from '../../lib/api'
import type { FocusRequest } from './useWorkspace'

interface Props {
  problem: string
  draft: string
  busy: boolean
  error: string | null
  notice: string | null
  focusRequest: FocusRequest | null
  onProblemChange: (value: string) => void
  onDraftChange: (value: string) => void
  onLoadExample: () => void
  onInspect: () => void
  onReset: () => void
}

const fieldClass =
  'w-full rounded-md border border-rule bg-surface px-4 py-3 font-serif text-lg leading-relaxed ' +
  'placeholder:text-muted focus-visible:border-accent'

const quietButton =
  'rounded-md px-3 py-2.5 text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

export function FreeformEditor({
  problem,
  draft,
  busy,
  error,
  notice,
  focusRequest,
  onProblemChange,
  onDraftChange,
  onLoadExample,
  onInspect,
  onReset,
}: Props) {
  const draftField = useRef<HTMLTextAreaElement>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)

  const canInspect = draft.trim().length > 0 && !busy
  const hasWork = problem !== '' || draft !== ''

  useEffect(() => {
    const field = draftField.current
    if (!focusRequest || !field) return
    field.focus()
    if (focusRequest.range) {
      field.setSelectionRange(focusRequest.range.start, focusRequest.range.end)
    }
  }, [focusRequest])

  function inspectOnShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canInspect) {
      event.preventDefault()
      onInspect()
    }
  }

  return (
    <div className="space-y-6" aria-busy={busy}>
      <div>
        <label htmlFor="problem" className="mb-2 block text-sm font-medium text-muted">
          Problem
        </label>
        <textarea
          id="problem"
          rows={2}
          maxLength={MAX_PROBLEM_CHARS}
          value={problem}
          onChange={(e) => onProblemChange(e.target.value)}
          onKeyDown={inspectOnShortcut}
          placeholder="What are you trying to show?"
          className={fieldClass + ' resize-y'}
        />
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <label htmlFor="draft" className="block text-sm font-medium text-muted">
            Your reasoning
          </label>
          <span className="text-xs text-muted">Saved in this browser</span>
        </div>
        <textarea
          id="draft"
          ref={draftField}
          rows={9}
          maxLength={MAX_DRAFT_CHARS}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={inspectOnShortcut}
          placeholder="Write it your way. Rough steps are fine."
          className={fieldClass + ' min-h-48 resize-y'}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onInspect}
          disabled={!canInspect}
          aria-describedby="inspect-note"
          aria-keyshortcuts="Control+Enter Meta+Enter"
          className="rounded-md bg-accent px-5 py-2.5 font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-rule disabled:text-muted"
        >
          {busy ? 'Inspecting…' : 'Inspect reasoning'}
        </button>
        <button
          type="button"
          onClick={onLoadExample}
          disabled={busy}
          className="rounded-md border border-accent px-5 py-2.5 font-medium text-accent transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          Try an example
        </button>

        <div className="sm:ml-auto">
          {confirmingReset ? (
            <span className="flex flex-wrap items-center gap-1 text-sm">
              <span className="text-muted">Clear the problem and your reasoning?</span>
              <button
                type="button"
                className={quietButton + ' text-ink'}
                onClick={() => {
                  setConfirmingReset(false)
                  onReset()
                }}
              >
                Yes, clear
              </button>
              <button type="button" className={quietButton} onClick={() => setConfirmingReset(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              className={quietButton}
              disabled={!hasWork}
              onClick={() => setConfirmingReset(true)}
            >
              Clear workspace
            </button>
          )}
        </div>
      </div>

      {/* One live region, so screen readers hear each change of state. */}
      <div id="inspect-note" aria-live="polite" className="min-h-10 text-sm">
        {busy ? (
          <p className="text-muted">Reading your draft. This usually takes a few seconds.</p>
        ) : error ? (
          <p className="border-l-2 border-flag pl-3">
            <span className="font-medium">{error}</span>{' '}
            <span className="text-muted">Your draft is unchanged. You can try again.</span>
          </p>
        ) : notice ? (
          <p className="border-l-2 border-flag pl-3">{notice}</p>
        ) : (
          <p className="text-muted">
            Hetu asks a model to read your draft and question one step. It does not write the proof. Shortcut: Ctrl
            or ⌘ with Enter.
          </p>
        )}
      </div>
    </div>
  )
}
