import type { ReactNode } from 'react'
import type { Intent } from '../../lib/types'
import { SampleExchange } from './SampleExchange'
import { STARTS } from './starts'

interface Props {
  intent: Intent | null
  onChoose: (intent: Intent | null) => void
  onOpenWorkspace: () => void
  /** Shown under the starting points: recent conversations, or how saving works. */
  children?: ReactNode
}

/**
 * The first screen of a session. Where there is room, an example exchange
 * sits beside it. Choosing a starting point is optional; anyone can just type.
 */
export function Welcome({ intent, onChoose, onOpenWorkspace, children }: Props) {
  return (
    <div className="@container flex flex-1 flex-col justify-center py-6 sm:py-10">
      <div className="grid items-center gap-10 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @4xl:gap-14">
        <div>
          <h2 className="font-serif text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">
            Learn it well enough to explain it.
          </h2>
          <p className="mt-4 max-w-xl text-lg text-muted">
            Hetu explains when you need it, steps back when you want to try, and questions a step that does not follow.
            Any subject, at your level.
          </p>

          <h3 className="mt-8 text-sm font-medium">What are you working on?</h3>
          <div role="group" aria-label="Starting point" className="mt-3 grid gap-2 sm:grid-cols-3 @4xl:grid-cols-1">
            {STARTS.map((start) => {
              const chosen = intent === start.intent
              return (
                <button
                  key={start.intent}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => onChoose(chosen ? null : start.intent)}
                  className={
                    'flex flex-col items-start rounded-lg border px-4 py-3 text-left transition-colors ' +
                    (chosen ? 'border-accent bg-accent-soft' : 'border-rule bg-surface hover:border-accent')
                  }
                >
                  <span className="font-serif text-lg font-semibold">{start.title}</span>
                  <span className="mt-0.5 text-sm text-muted">{start.description}</span>
                </button>
              )
            })}
          </div>

          {intent === 'examine' && (
            <p className="mt-3 text-sm text-muted">
              Longer work is easier to write in the workspace.{' '}
              <button
                type="button"
                className="font-medium text-accent underline underline-offset-4"
                onClick={onOpenWorkspace}
              >
                Open the workspace
              </button>
            </p>
          )}

          {children}

          <p className="mt-6 text-xs text-muted">Hetu is a language model and can be wrong. Check what matters.</p>
        </div>

        <div className="hidden @4xl:block">
          <SampleExchange />
        </div>
      </div>
    </div>
  )
}
