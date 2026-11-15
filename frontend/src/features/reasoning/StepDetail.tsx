import { useState } from 'react'
import { MathText } from '../../components/MathText'
import { MAX_CHALLENGE_CHARS } from '../../lib/api'
import { TYPE_LABELS } from '../../lib/labels'
import type { Observation, ReasoningNode } from '../../lib/types'

interface Props {
  node: ReasoningNode
  number: number
  /** Step numbers this step relies on, and step numbers that rely on it. */
  reliesOn: number[]
  usedBy: number[]
  observation: Observation | null
  /** False for the hand-written sample, which has no model behind it to ask. */
  canChallenge: boolean
  challenging: boolean
  challengeError: string | null
  onRevise: () => void
  onDiscuss: () => void
  onChallenge: (reason: string) => void
}

const actionButton =
  'rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent-soft ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

function listSteps(numbers: number[]): string {
  return numbers.map((n) => `step ${n}`).join(', ')
}

/** Everything Hetu knows about one step, with the ways to respond to it. */
export function StepDetail({
  node,
  number,
  reliesOn,
  usedBy,
  observation,
  canChallenge,
  challenging,
  challengeError,
  onRevise,
  onDiscuss,
  onChallenge,
}: Props) {
  const [challengeOpen, setChallengeOpen] = useState(false)
  const [reason, setReason] = useState('')

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium tracking-wide text-muted uppercase">
          Step {number} · {TYPE_LABELS[node.type]}
        </p>
        <p className="mt-1 font-serif text-lg leading-relaxed">
          <MathText text={node.text} />
        </p>
      </div>

      <dl className="space-y-1 text-sm text-muted">
        <div className="flex gap-2">
          <dt className="font-medium">Relies on:</dt>
          <dd>{reliesOn.length > 0 ? listSteps(reliesOn) : 'no other step'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">Used by:</dt>
          <dd>{usedBy.length > 0 ? listSteps(usedBy) : 'no other step'}</dd>
        </div>
      </dl>

      {node.span === null && (
        <p className="text-sm text-muted">
          Hetu could not find this exact wording in your draft, so nothing is highlighted for it.
        </p>
      )}

      {observation ? (
        <div className="rounded-md border-l-4 border-flag bg-flag-soft px-4 py-4">
          <p className="text-sm font-medium text-flag">Hetu's question</p>
          <p className="mt-1 font-serif text-xl leading-relaxed">
            <MathText text={observation.question} />
          </p>
          {observation.hint && (
            <details className="mt-3 text-sm">
              <summary className="w-fit cursor-pointer font-medium text-flag">Show a hint</summary>
              <p className="mt-2">
                <MathText text={observation.hint} />
              </p>
            </details>
          )}
          <p className="mt-3 text-xs text-muted">
            {observation.verification === 'tool_verified' ? 'Confirmed by a deterministic check.' : 'A model’s judgment.'}
          </p>
        </div>
      ) : (
        <p className="text-sm">Hetu has no question about this step. It has not checked that the step is correct.</p>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="button" className={actionButton} onClick={onRevise}>
          Revise this step
        </button>
        <button type="button" className={actionButton} onClick={onDiscuss}>
          Ask about this step
        </button>
        {observation && canChallenge && !challengeOpen && (
          <button type="button" className={actionButton} onClick={() => setChallengeOpen(true)}>
            Challenge Hetu
          </button>
        )}
      </div>

      {observation && canChallenge && challengeOpen && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (reason.trim() !== '') onChallenge(reason.trim())
          }}
        >
          <label htmlFor="challenge-reason" className="block text-sm font-medium">
            Why do you think this step is justified?
          </label>
          <textarea
            id="challenge-reason"
            rows={3}
            maxLength={MAX_CHALLENGE_CHARS}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-describedby="challenge-note"
            className="w-full rounded-md border border-rule bg-surface px-3 py-2 font-serif leading-relaxed focus-visible:border-accent"
          />
          <p id="challenge-note" className="text-xs text-muted">
            Hetu reads your draft again with your reason. It may withdraw the question or explain what is still missing.
            Your draft is not changed.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={challenging || reason.trim() === ''}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-rule disabled:text-muted"
            >
              {challenging ? 'Reconsidering…' : 'Send challenge'}
            </button>
            <button type="button" className={actionButton} disabled={challenging} onClick={() => setChallengeOpen(false)}>
              Cancel
            </button>
          </div>
          <p aria-live="polite" className="text-sm">
            {challengeError && (
              <>
                <span className="font-medium">{challengeError}</span>{' '}
                <span className="text-muted">The earlier analysis is still shown. You can try again.</span>
              </>
            )}
          </p>
        </form>
      )}
    </div>
  )
}
