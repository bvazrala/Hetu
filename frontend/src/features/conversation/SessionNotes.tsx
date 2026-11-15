import type { LearningState } from '../../lib/types'
import type { NoteList } from './useConversation'

interface Props {
  notes: LearningState | null
  onRemove: (list: NoteList, item: string) => void
}

const GROUPS: { list: NoteList; title: string; empty: string }[] = [
  { list: 'concepts', title: 'Discussed', empty: 'Nothing yet.' },
  {
    list: 'understood',
    title: 'You have shown',
    empty: 'Nothing yet. This fills in from your own explanations and work.',
  },
  { list: 'misconceptions', title: 'Possible misconceptions', empty: 'None noted.' },
  { list: 'open_questions', title: 'Still exploring', empty: 'Nothing noted.' },
]

/**
 * Hetu's running notes on the session. The student can read them and remove
 * anything that is wrong. Hetu is told about each removal.
 */
export function SessionNotes({ notes, onRemove }: Props) {
  if (!notes) return null
  const count = GROUPS.reduce((total, { list }) => total + notes[list].length, 0)
  if (count === 0 && !notes.goal && !notes.topic) return null

  return (
    <details className="group rounded-lg border border-rule bg-surface text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-90">
          ›
        </span>
        <span className="font-medium">Session notes</span>
        {notes.topic && <span className="truncate text-muted">{notes.topic}</span>}
      </summary>

      <div className="space-y-4 border-t border-rule px-4 py-4">
        {notes.goal && (
          <p>
            <span className="font-medium">Goal: </span>
            <span className="text-muted">{notes.goal}</span>
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {GROUPS.map(({ list, title, empty }) => (
            <section key={list} aria-labelledby={`notes-${list}`}>
              <h3 id={`notes-${list}`} className="eyebrow">
                {title}
              </h3>
              {notes[list].length === 0 ? (
                <p className="mt-1 text-muted">{empty}</p>
              ) : (
                <ul role="list" className="mt-1 space-y-1">
                  {notes[list].map((item) => (
                    <li key={item} className="flex items-start justify-between gap-2">
                      <span>{item}</span>
                      <button
                        type="button"
                        aria-label={`Remove note: ${item}`}
                        title="Remove this note"
                        onClick={() => onRemove(list, item)}
                        className="-mt-0.5 shrink-0 rounded px-1.5 text-base leading-6 text-muted hover:bg-accent-soft hover:text-ink"
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
        <p className="text-xs text-muted">
          Hetu keeps these notes to follow this session. They are tentative readings of the conversation, not a measure
          of what you know. Remove anything that is wrong and Hetu will not add it back.
        </p>
      </div>
    </details>
  )
}
