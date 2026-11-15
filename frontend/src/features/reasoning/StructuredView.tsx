import { useState, type RefObject } from 'react'
import { MathText } from '../../components/MathText'
import { toLinks } from '../../lib/graph'
import { TYPE_LABELS } from '../../lib/labels'
import { toStringRange } from '../../lib/spans'
import type { Observation, ReasoningNode } from '../../lib/types'
import type { Inspection } from '../workspace/useWorkspace'
import { ReasoningGraph } from './ReasoningGraph'
import { StepDetail } from './StepDetail'

interface Props {
  draft: string
  /** The analysis for the current text, or null. */
  inspection: Inspection | null
  /** True when an analysis exists but the text has changed since. */
  stale: boolean
  busy: 'inspect' | 'challenge' | null
  error: string | null
  challengeError: string | null
  /** The view's heading. The app moves focus here when a new analysis arrives. */
  headingRef: RefObject<HTMLHeadingElement | null>
  onInspect: () => void
  onRevise: (node: ReasoningNode) => void
  onChallenge: (node: ReasoningNode, observation: Observation, reason: string) => void
}

const sectionHeading = 'mb-2 text-sm font-medium text-muted'

export function StructuredView(props: Props) {
  const { inspection, stale, busy, error, headingRef, onInspect } = props

  if (!inspection) {
    return (
      <div className="rounded-md border border-dashed border-rule px-5 py-8 text-center">
        <h2 ref={headingRef} tabIndex={-1} className="font-medium">
          {stale ? 'Your draft has changed since the last analysis.' : 'Nothing inspected yet.'}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          {stale
            ? 'The earlier feedback no longer matches what you wrote, so it is not shown.'
            : 'Share a proof in the conversation, or write one in Freeform and select Inspect reasoning.'}
        </p>
        {stale && (
          <button
            type="button"
            onClick={onInspect}
            disabled={busy !== null}
            className="mt-5 rounded-md bg-accent px-5 py-2.5 font-medium text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-rule disabled:text-muted"
          >
            {busy === 'inspect' ? 'Inspecting…' : 'Inspect current draft'}
          </button>
        )}
        <p aria-live="polite" className="mt-3 text-sm">
          {stale && error && (
            <>
              <span className="font-medium">{error}</span> <span className="text-muted">Your draft is unchanged.</span>
            </>
          )}
        </p>
      </div>
    )
  }

  return <AnalysisView {...props} inspection={inspection} />
}

function AnalysisView({
  draft,
  inspection,
  busy,
  challengeError,
  headingRef,
  onRevise,
  onChallenge,
}: Props & { inspection: Inspection }) {
  const { analysis, fallbackReason, challengeReason } = inspection

  // One question at a time: only the first observation is shown.
  const observation = analysis.observations.at(0) ?? null
  const flagged = new Set(observation ? [observation.target] : [])
  const [selectedId, setSelectedId] = useState<string | null>(observation?.target ?? null)

  const stepNumber = new Map(analysis.nodes.map((node, index) => [node.id, index + 1]))
  const links = toLinks(analysis.nodes, analysis.edges)
  const numbersOf = (ids: string[]) => ids.map((id) => stepNumber.get(id)!).sort((a, b) => a - b)
  const reliesOn = (id: string) => numbersOf(links.filter((link) => link.to === id).map((link) => link.from))
  const usedBy = (id: string) => numbersOf(links.filter((link) => link.from === id).map((link) => link.to))

  const selected = analysis.nodes.find((node) => node.id === selectedId) ?? null
  const selectedRange = selected ? toStringRange(draft, selected.span) : null
  const selectedHasQuestion = selected !== null && flagged.has(selected.id)

  return (
    <div className="space-y-8">
      <div>
        <h2 ref={headingRef} tabIndex={-1} className="font-serif text-xl font-semibold">
          Analysis
        </h2>
        <p className="mt-2 text-sm text-muted">
          {analysis.source === 'sample' ? (
            <>
              <span className="font-medium text-ink">Sample analysis.</span> Written by hand for this example. No model
              was called.{fallbackReason && ` Shown because live analysis failed: ${fallbackReason}`}
            </>
          ) : (
            <>
              <span className="font-medium text-ink">A model read your draft.</span> It can misread a step. Nothing
              here is a formal check.
            </>
          )}
        </p>
      </div>

      {challengeReason && analysis.challenge && (
        <section aria-labelledby="challenge-heading" className="rounded-md border border-rule bg-surface px-5 py-4">
          <h3 id="challenge-heading" className="font-medium">
            {analysis.challenge.outcome === 'withdrawn'
              ? 'Hetu withdrew its question'
              : 'Hetu still has its question'}
          </h3>
          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="font-medium text-muted">You said</dt>
              <dd className="mt-0.5 font-serif text-base">{challengeReason}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted">Hetu replied</dt>
              <dd className="mt-0.5 font-serif text-base">
                <MathText text={analysis.challenge.response} />
              </dd>
            </div>
          </dl>
        </section>
      )}

      {!observation && (
        <div className="rounded-md border border-rule bg-surface px-5 py-4">
          <p className="font-medium">Hetu has no question about this draft.</p>
          <p className="mt-1 text-sm text-muted">
            It found nothing to ask. That is one reading by a model, not a check that the argument is correct.
          </p>
        </div>
      )}

      <section aria-labelledby="graph-heading">
        <h3 id="graph-heading" className={sectionHeading}>
          Reasoning graph
        </h3>
        <ReasoningGraph
          nodes={analysis.nodes}
          edges={analysis.edges}
          flagged={flagged}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </section>

      <section
        id="step-detail"
        aria-labelledby="detail-heading"
        aria-live="polite"
        className="rounded-md border border-rule bg-surface px-5 py-5"
      >
        <h3 id="detail-heading" className={sectionHeading}>
          Selected step
        </h3>
        {selected ? (
          <StepDetail
            // A fresh panel per step, so a half-written challenge does not follow the selection.
            key={selected.id}
            node={selected}
            number={stepNumber.get(selected.id)!}
            reliesOn={reliesOn(selected.id)}
            usedBy={usedBy(selected.id)}
            observation={selectedHasQuestion ? observation : null}
            canChallenge={analysis.source === 'live'}
            challenging={busy === 'challenge'}
            challengeError={challengeError}
            onRevise={() => onRevise(selected)}
            onChallenge={(reason) => observation && onChallenge(selected, observation, reason)}
          />
        ) : (
          <p className="text-sm">Select a step in the graph, or in the list below, to see what it relies on.</p>
        )}
      </section>

      <section aria-labelledby="draft-heading">
        <h3 id="draft-heading" className={sectionHeading}>
          Your draft
        </h3>
        <p className="font-serif text-lg leading-relaxed whitespace-pre-wrap">
          {selectedRange ? (
            <>
              {draft.slice(0, selectedRange.start)}
              <mark
                className={
                  'rounded-sm px-0.5 text-ink underline decoration-2 underline-offset-4 ' +
                  (selectedHasQuestion ? 'bg-flag-soft decoration-flag' : 'bg-transparent decoration-ink')
                }
              >
                <span className="sr-only">Start of step {stepNumber.get(selected!.id)}. </span>
                {draft.slice(selectedRange.start, selectedRange.end)}
                <span className="sr-only"> End of step {stepNumber.get(selected!.id)}.</span>
              </mark>
              {draft.slice(selectedRange.end)}
            </>
          ) : (
            draft
          )}
        </p>
      </section>

      <section aria-labelledby="steps-heading">
        <h3 id="steps-heading" className={sectionHeading}>
          Steps as text
        </h3>
        {/* Safari drops list semantics when list styling is removed, so the role is stated. */}
        <ol role="list" aria-labelledby="steps-heading" className="divide-y divide-rule border-y border-rule">
          {analysis.nodes.map((node, index) => {
            const isSelected = node.id === selectedId
            const prerequisites = reliesOn(node.id)
            return (
              <li
                key={node.id}
                aria-current={isSelected ? 'true' : undefined}
                className={'py-3 ' + (isSelected ? 'border-l-2 border-ink pl-3' : 'pl-[14px]')}
              >
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-controls="step-detail"
                  onClick={() => setSelectedId(node.id)}
                  className="flex w-full gap-3 rounded-sm text-left"
                >
                  <span aria-hidden="true" className="w-5 shrink-0 pt-0.5 text-right text-sm text-muted tabular-nums">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-xs font-medium tracking-wide text-muted uppercase">
                      <span className="sr-only">Step {index + 1}, </span>
                      {TYPE_LABELS[node.type]}
                      {flagged.has(node.id) && (
                        <span className="rounded-full border border-flag px-1.5 text-[0.65rem] text-flag normal-case">
                          Question
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block font-serif text-lg leading-relaxed">
                      <MathText text={node.text} />
                    </span>
                  </span>
                </button>
                <div className="mt-1 space-y-1 pl-8 text-sm text-muted">
                  {prerequisites.length > 0 && (
                    <p>
                      Relies on {prerequisites.length === 1 ? 'step' : 'steps'} {prerequisites.join(', ')}
                    </p>
                  )}
                  {node.span === null && <p>Not matched to exact text in your draft.</p>}
                  {observation && flagged.has(node.id) && (
                    <p className="text-ink">
                      <span className="font-medium">Question: </span>
                      <MathText text={observation.question} />
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      {analysis.limitations.length > 0 && (
        <section aria-labelledby="limits-heading">
          <h3 id="limits-heading" className={sectionHeading}>
            Limitations
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {analysis.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
