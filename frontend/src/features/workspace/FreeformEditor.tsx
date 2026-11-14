interface Props {
  problem: string
  draft: string
  canInspect: boolean
  onProblemChange: (value: string) => void
  onDraftChange: (value: string) => void
  onLoadExample: () => void
  onInspect: () => void
}

const fieldClass =
  'w-full rounded-md border border-rule bg-surface px-4 py-3 font-serif text-lg leading-relaxed ' +
  'placeholder:text-muted/70 focus-visible:border-accent'

export function FreeformEditor({
  problem,
  draft,
  canInspect,
  onProblemChange,
  onDraftChange,
  onLoadExample,
  onInspect,
}: Props) {
  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="problem" className="mb-2 block text-sm font-medium text-muted">
          Problem
        </label>
        <textarea
          id="problem"
          rows={2}
          value={problem}
          onChange={(e) => onProblemChange(e.target.value)}
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
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
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
          className="rounded-md bg-accent px-5 py-2.5 font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-rule disabled:text-muted"
        >
          Inspect reasoning
        </button>
        <button
          type="button"
          onClick={onLoadExample}
          className="rounded-md border border-accent px-5 py-2.5 font-medium text-accent transition-colors hover:bg-accent-soft"
        >
          Try an example
        </button>
      </div>

      <p id="inspect-note" className="text-sm text-muted">
        {canInspect
          ? 'This is the unedited example. Inspect shows a sample written by hand, not a live analysis.'
          : 'Live analysis is not connected yet. Load the example to see a sample written by hand.'}
      </p>
    </div>
  )
}
