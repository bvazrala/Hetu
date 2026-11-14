import type { KeyboardEvent } from 'react'
import { MAX_DRAFT_CHARS, MAX_PROBLEM_CHARS } from '../../lib/api'

interface Props {
  problem: string
  draft: string
  busy: boolean
  error: string | null
  onProblemChange: (value: string) => void
  onDraftChange: (value: string) => void
  onLoadExample: () => void
  onInspect: () => void
}

const fieldClass =
  'w-full rounded-md border border-rule bg-surface px-4 py-3 font-serif text-lg leading-relaxed ' +
  'placeholder:text-muted focus-visible:border-accent'

export function FreeformEditor({
  problem,
  draft,
  busy,
  error,
  onProblemChange,
  onDraftChange,
  onLoadExample,
  onInspect,
}: Props) {
  const canInspect = draft.trim().length > 0 && !busy

  // Ctrl+Enter, or Command+Enter on a Mac, inspects without leaving the keyboard.
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
        <label htmlFor="draft" className="mb-2 block text-sm font-medium text-muted">
          Your reasoning
        </label>
        <textarea
          id="draft"
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
      </div>

      {/* One live region, so screen readers hear each change of state. */}
      <div id="inspect-note" aria-live="polite" className="min-h-10 text-sm">
        {busy ? (
          <p className="text-muted">Reading your draft. This usually takes a few seconds.</p>
        ) : error ? (
          <p className="border-l-2 border-accent pl-3">
            <span className="font-medium">{error}</span>{' '}
            <span className="text-muted">Your draft is unchanged. You can try again.</span>
          </p>
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
