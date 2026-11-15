import type { KeyboardEvent } from 'react'
import { MathText } from '../../components/MathText'
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from '../../lib/graph'
import { TYPE_LABELS } from '../../lib/labels'
import type { Edge, NodeType, ReasoningNode } from '../../lib/types'

interface Props {
  nodes: ReasoningNode[]
  edges: Edge[]
  /** Ids of steps that Hetu has a question about. */
  flagged: Set<string>
  selectedId: string | null
  onSelect: (id: string) => void
}

// Each kind of step has its own border, so the kinds can be told apart
// without colour. No kind is green: an unquestioned step is not a verified one.
const TYPE_BORDERS: Record<NodeType, string> = {
  assumption: 'border border-dashed border-muted',
  claim: 'border border-dotted border-muted',
  inference: 'border border-solid border-muted',
  conclusion: 'border-[3px] border-double border-ink',
}

const LEGEND: NodeType[] = ['assumption', 'claim', 'inference', 'conclusion']

/** A drawing of the steps. Arrows run from a step to the steps that rely on it. */
export function ReasoningGraph({ nodes, edges, flagged, selectedId, onSelect }: Props) {
  const layout = layoutGraph(nodes, edges)
  const position = new Map(layout.nodes.map((placed) => [placed.id, placed]))
  const stepNumber = new Map(nodes.map((node, index) => [node.id, index + 1]))

  // Read after the visible text of a step, for screen reader users.
  function relations(node: ReasoningNode): string {
    const reliesOn = layout.links.filter((link) => link.to === node.id).map((link) => stepNumber.get(link.from))
    const parts = [reliesOn.length > 0 ? `Relies on step ${reliesOn.join(' and step ')}.` : 'Relies on no other step.']
    if (flagged.has(node.id)) parts.push('Hetu has a question about this step.')
    if (node.span === null) parts.push('Not matched to exact text in your draft.')
    return parts.join(' ')
  }

  // Arrow keys move between steps in reading order. Tab still works too.
  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight'
    const backward = event.key === 'ArrowUp' || event.key === 'ArrowLeft'
    if (!forward && !backward) return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-step]')]
    const next = buttons.indexOf(document.activeElement as HTMLButtonElement) + (forward ? 1 : -1)
    if (next >= 0 && next < buttons.length) {
      event.preventDefault()
      buttons[next].focus()
    }
  }

  return (
    <figure>
      <div
        role="group"
        aria-label="Reasoning graph. Each step is a button. Arrows point from a step to the steps that rely on it."
        onKeyDown={moveFocus}
        className="overflow-x-auto rounded-md border border-rule bg-surface px-4 py-6"
      >
        <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
          <svg
            width={layout.width}
            height={layout.height}
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
          >
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted" />
              </marker>
              <marker
                id="arrow-strong"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-ink" />
              </marker>
            </defs>
            {layout.links.map((link) => {
              const touchesSelection = link.from === selectedId || link.to === selectedId
              return (
                <path
                  key={`${link.from}>${link.to}`}
                  d={link.path}
                  fill="none"
                  data-from={link.from}
                  data-to={link.to}
                  className={touchesSelection ? 'stroke-ink' : 'stroke-muted'}
                  strokeWidth={touchesSelection ? 2 : 1.25}
                  markerEnd={touchesSelection ? 'url(#arrow-strong)' : 'url(#arrow)'}
                />
              )
            })}
          </svg>

          {nodes.map((node) => {
            const placed = position.get(node.id)
            if (!placed) return null
            const selected = node.id === selectedId
            const hasQuestion = flagged.has(node.id)
            return (
              <button
                key={node.id}
                type="button"
                data-step={node.id}
                aria-pressed={selected}
                aria-controls="step-detail"
                onClick={() => onSelect(node.id)}
                style={{ left: placed.x, top: placed.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
                className={
                  'absolute flex flex-col gap-1 rounded-md px-3 py-2 text-left transition-shadow ' +
                  TYPE_BORDERS[node.type] +
                  (hasQuestion ? ' bg-flag-soft' : ' bg-paper') +
                  (selected ? ' shadow-[0_0_0_2px_var(--color-ink)]' : ' hover:shadow-[0_0_0_1px_var(--color-muted)]')
                }
              >
                {/* The spaces between parts keep them apart in the button's accessible name. */}
                <span className="flex items-center justify-between gap-2 text-xs font-medium tracking-wide uppercase">
                  <span className="whitespace-nowrap text-muted">
                    <span className="sr-only">Step</span> {stepNumber.get(node.id)} · {TYPE_LABELS[node.type]}
                  </span>{' '}
                  {hasQuestion ? (
                    <span className="rounded-full border border-flag px-1.5 text-[0.65rem] text-flag normal-case">
                      Question
                    </span>
                  ) : (
                    node.span === null && <span className="text-[0.65rem] text-muted normal-case">Not in draft</span>
                  )}
                </span>{' '}
                <span className="line-clamp-2 font-serif text-sm leading-snug">
                  <MathText text={node.text} />
                </span>{' '}
                <span className="sr-only">{relations(node)}</span>
              </button>
            )
          })}
        </div>
      </div>

      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {LEGEND.map((type) => (
          <span key={type} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={'inline-block h-3 w-5 rounded-sm ' + TYPE_BORDERS[type]} />
            {TYPE_LABELS[type]}
          </span>
        ))}
        <span>An arrow points to a step that relies on the one before it.</span>
      </figcaption>
    </figure>
  )
}
