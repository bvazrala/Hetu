import type { Analysis, ReasoningNode } from '../../lib/types'

interface Props {
  draft: string
  analysis: Analysis | null
  onLoadExample: () => void
}

const TYPE_LABELS: Record<ReasoningNode['type'], string> = {
  assumption: 'Assumption',
  claim: 'Claim',
  inference: 'Inference',
  conclusion: 'Conclusion',
}

export function StructuredView({ draft, analysis, onLoadExample }: Props) {
  if (!analysis) {
    return (
      <div className="rounded-md border border-dashed border-rule px-5 py-8 text-center">
        <p className="font-medium">No structure to show yet.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Live analysis is not connected, so Hetu cannot read your own draft yet. The unedited example has a sample
          written by hand. Your draft is unchanged in Freeform.
        </p>
        <button
          type="button"
          onClick={onLoadExample}
          className="mt-5 rounded-md border border-accent px-5 py-2.5 font-medium text-accent transition-colors hover:bg-accent-soft"
        >
          Try an example
        </button>
      </div>
    )
  }

  // One suggestion at a time: only the first observation is shown.
  const observation = analysis.observations.at(0)
  const stepNumber = new Map(analysis.nodes.map((node, index) => [node.id, index + 1]))
  const questioned = analysis.nodes.find((node) => node.id === observation?.target)

  return (
    <div className="space-y-8">
      {analysis.source === 'sample' && (
        <p className="border-l-2 border-accent pl-3 text-sm text-muted">
          <span className="font-medium text-ink">Sample analysis.</span> Written by hand for this example. No model was
          called.
        </p>
      )}

      <section aria-labelledby="draft-heading">
        <h2 id="draft-heading" className="mb-2 text-sm font-medium text-muted">
          Your draft
        </h2>
        <p className="font-serif text-lg leading-relaxed whitespace-pre-wrap">
          <DraftWithHighlight draft={draft} node={questioned} />
        </p>
      </section>

      <section aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="mb-2 text-sm font-medium text-muted">
          Steps as Hetu reads them
        </h2>
        <ol className="divide-y divide-rule border-y border-rule">
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
                    <p className="mt-1 font-serif text-lg leading-relaxed">{node.text}</p>
                    {reliesOn.length > 0 && (
                      <p className="mt-1 text-sm text-muted">
                        Relies on {reliesOn.length === 1 ? 'step' : 'steps'} {reliesOn.join(', ')}
                      </p>
                    )}

                    {observation && observation.target === node.id && (
                      <div className="mt-4 rounded-md bg-accent-soft px-4 py-3">
                        <p className="text-sm font-medium text-accent-strong">A question about this step</p>
                        <p className="mt-1 font-serif text-lg leading-relaxed">{observation.question}</p>
                        {observation.hint && (
                          <details className="mt-3 text-sm">
                            <summary className="w-fit cursor-pointer font-medium text-accent-strong">
                              Show a hint
                            </summary>
                            <p className="mt-2">{observation.hint}</p>
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

      {analysis.limitations.length > 0 && (
        <section aria-labelledby="limits-heading">
          <h2 id="limits-heading" className="mb-2 text-sm font-medium text-muted">
            Limitations
          </h2>
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
        {draft.slice(span.start, span.end)}
      </mark>
      {draft.slice(span.end)}
    </>
  )
}
