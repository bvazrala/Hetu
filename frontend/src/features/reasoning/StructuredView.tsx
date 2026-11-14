import type { RefObject } from 'react'
import { MathText } from '../../components/MathText'
import type { Analysis, ReasoningNode } from '../../lib/types'

interface Props {
  draft: string
  analysis: Analysis | null
  /** True when an analysis exists but the draft has changed since. */
  stale: boolean
  /** Why live analysis failed, when the hand-written sample is shown instead. */
  fallbackReason: string | null
  /** The view's heading. The app moves focus here when a new analysis arrives. */
  headingRef: RefObject<HTMLHeadingElement | null>
}

const TYPE_LABELS: Record<ReasoningNode['type'], string> = {
  assumption: 'Assumption',
  claim: 'Claim',
  inference: 'Inference',
  conclusion: 'Conclusion',
}

export function StructuredView({ draft, analysis, stale, fallbackReason, headingRef }: Props) {
  if (!analysis) {
    return (
      <div className="rounded-md border border-dashed border-rule px-5 py-8 text-center">
        <h2 ref={headingRef} tabIndex={-1} className="font-medium">
          {stale ? 'Your draft has changed.' : 'Nothing inspected yet.'}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          {stale
            ? 'The last analysis no longer matches what you wrote. Switch to Freeform and inspect again.'
            : 'Switch to Freeform, write your reasoning, and select Inspect reasoning.'}
        </p>
      </div>
    )
  }

  // One suggestion at a time: only the first observation is shown.
  const observation = analysis.observations.at(0)
  const stepNumber = new Map(analysis.nodes.map((node, index) => [node.id, index + 1]))
  const questioned = analysis.nodes.find((node) => node.id === observation?.target)

  return (
    <div className="space-y-8">
      <h2 ref={headingRef} tabIndex={-1} className="font-serif text-xl font-semibold">
        Analysis
      </h2>

      <p className="border-l-2 border-accent pl-3 text-sm text-muted">
        {analysis.source === 'sample' ? (
          <>
            <span className="font-medium text-ink">Sample analysis.</span> Written by hand for this example. No model
            was called.{fallbackReason && ` Shown because live analysis failed: ${fallbackReason}`}
          </>
        ) : (
          <>
            <span className="font-medium text-ink">Model analysis.</span> A model read your draft. It can misread a
            step, so treat this as a second reader, not a grade.
          </>
        )}
      </p>

      <section aria-labelledby="draft-heading">
        <h3 id="draft-heading" className="mb-2 text-sm font-medium text-muted">
          Your draft
        </h3>
        <p className="font-serif text-lg leading-relaxed whitespace-pre-wrap">
          <DraftWithHighlight draft={draft} node={questioned} />
        </p>
      </section>

      <section aria-labelledby="steps-heading">
        <h3 id="steps-heading" className="mb-2 text-sm font-medium text-muted">
          Steps as Hetu reads them
        </h3>
        <ol role="list" className="divide-y divide-rule border-y border-rule">
          {analysis.nodes.map((node, index) => {
            const reliesOn = analysis.edges
              .filter((edge) => edge.source === node.id)
              .map((edge) => stepNumber.get(edge.target))
              .filter((n) => n !== undefined)

            return (
              <li key={node.id} className="py-4">
                <div className="flex gap-4">
                  <span aria-hidden="true" className="w-5 shrink-0 pt-1 text-right text-sm text-muted tabular-nums">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium tracking-wide text-accent uppercase">{TYPE_LABELS[node.type]}</p>
                    <p className="mt-1 font-serif text-lg leading-relaxed">
                      <MathText text={node.text} />
                    </p>
                    {reliesOn.length > 0 && (
                      <p className="mt-1 text-sm text-muted">
                        Relies on {reliesOn.length === 1 ? 'step' : 'steps'} {reliesOn.join(', ')}
                      </p>
                    )}

                    {observation && observation.target === node.id && (
                      <div className="mt-4 rounded-md bg-accent-soft px-4 py-3">
                        <p className="text-sm font-medium text-accent-strong">A question about this step</p>
                        <p className="mt-1 font-serif text-lg leading-relaxed">
                          <MathText text={observation.question} />
                        </p>
                        {observation.hint && (
                          <details className="mt-3 text-sm">
                            <summary className="w-fit cursor-pointer font-medium text-accent-strong">
                              Show a hint
                            </summary>
                            <p className="mt-2">
                              <MathText text={observation.hint} />
                            </p>
                          </details>
                        )}
                        <p className="mt-3 text-sm text-muted">
                          {observation.verification === 'tool_verified'
                            ? 'Confirmed by a deterministic check.'
                            : 'Not confirmed by a checker. Treat it as a question, not a verdict.'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      {!observation && (
        <div className="rounded-md bg-accent-soft px-4 py-3">
          <p className="font-medium text-accent-strong">No question this time.</p>
          <p className="mt-1 text-sm">
            Hetu did not find a step to question. That is one reader's view, not a proof that the argument is correct.
          </p>
        </div>
      )}

      {analysis.limitations.length > 0 && (
        <section aria-labelledby="limits-heading">
          <h3 id="limits-heading" className="mb-2 text-sm font-medium text-muted">
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

/** Renders the draft exactly as written, marking the passage in question. */
function DraftWithHighlight({ draft, node }: { draft: string; node: ReasoningNode | undefined }) {
  const span = node?.span
  if (!span) return <>{draft}</>
  return (
    <>
      {draft.slice(0, span.start)}
      <mark className="rounded-sm bg-accent-soft px-0.5 text-ink underline decoration-accent decoration-2 underline-offset-4">
        <span className="sr-only">Start of the step in question. </span>
        {draft.slice(span.start, span.end)}
        <span className="sr-only"> End of the step in question.</span>
      </mark>
      {draft.slice(span.end)}
    </>
  )
}
