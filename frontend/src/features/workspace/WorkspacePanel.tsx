import type { ReactNode } from 'react'
import type { WorkspaceView } from './useWorkspace'

interface Props {
  view: WorkspaceView
  onViewChange: (view: WorkspaceView) => void
  onClose: () => void
  /** True when an analysis of the current draft exists, so Structure has something to show. */
  hasStructure: boolean
  /** True when the panel sits beside the conversation rather than in its place. */
  sideBySide: boolean
  children: ReactNode
}

const VIEWS: { value: WorkspaceView; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'structure', label: 'Structure' },
]

/**
 * The workspace beside the conversation. On narrow screens it takes the
 * whole width and the conversation waits behind it, unchanged.
 */
export function WorkspacePanel({ view, onViewChange, onClose, hasStructure, sideBySide, children }: Props) {
  return (
    <aside
      id="workspace"
      aria-labelledby="workspace-heading"
      className="flex min-h-0 w-full flex-col lg:w-[min(46rem,50%)] lg:shrink-0 lg:border-l lg:border-rule"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-3 sm:px-8 lg:px-6">
        <h2 id="workspace-heading" className="sr-only font-serif text-lg font-semibold sm:not-sr-only">
          Workspace
        </h2>
        <div role="group" aria-label="Workspace view" className="inline-flex rounded-md border border-rule bg-surface p-0.5">
          {VIEWS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => onViewChange(value)}
              className={
                'rounded px-3 py-1 text-sm font-medium transition-colors ' +
                (view === value ? 'bg-accent text-on-accent' : 'text-muted hover:text-ink')
              }
            >
              {label}
              {value === 'structure' && hasStructure && view !== 'structure' && (
                <span className="ml-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-quiet btn-small ml-auto" onClick={onClose}>
          {sideBySide ? 'Close' : 'Back to conversation'}
        </button>
      </div>
      <div data-scroll className="relative min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 lg:px-6">
        {children}
      </div>
    </aside>
  )
}
