import type { Intent } from '../../lib/types'
import { STARTS } from './starts'

interface Props {
  intent: Intent | null
  onChoose: (intent: Intent | null) => void
  onOpenWorkspace: () => void
}

/** The first screen of a session. Choosing a starting point is optional. */
export function Welcome({ intent, onChoose, onOpenWorkspace }: Props) {
  return (
    <div className="py-4 sm:py-10">
      <h2 className="font-serif text-3xl leading-tight font-semibold sm:text-4xl">What are you working on?</h2>
      <p className="mt-3 max-w-2xl text-lg text-muted">
        Hetu helps you understand ideas and reason through them yourself. It explains when you need it, steps
        back when you want to try, and questions an argument when that helps.
      </p>

      <div role="group" aria-label="Starting point" className="mt-8 grid gap-3 sm:grid-cols-3">
        {STARTS.map((start) => {
          const chosen = intent === start.intent
          return (
            <button
              key={start.intent}
              type="button"
              aria-pressed={chosen}
              onClick={() => onChoose(chosen ? null : start.intent)}
              className={
                'flex flex-col items-start rounded-lg border px-4 py-4 text-left transition-colors ' +
                (chosen ? 'border-accent bg-accent-soft' : 'border-rule bg-surface hover:border-accent')
              }
            >
              <span className="font-serif text-lg font-semibold">{start.title}</span>
              <span className="mt-1 text-sm text-muted">{start.description}</span>
            </button>
          )
        })}
      </div>

      <p className="mt-4 text-sm text-muted">
        {intent === 'examine' ? (
          <>
            Longer work is easier to write in the workspace.{' '}
            <button type="button" className="font-medium text-accent underline underline-offset-4" onClick={onOpenWorkspace}>
              Open the workspace
            </button>
          </>
        ) : (
          'Choosing one is optional. You can also just type below.'
        )}
      </p>
    </div>
  )
}
