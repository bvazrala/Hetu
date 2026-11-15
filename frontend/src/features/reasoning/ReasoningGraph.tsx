import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
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

// Zoom steps. "Fit" shrinks a wide graph to the panel, but not below
// FIT_MINIMUM, so text stays readable; anything wider scrolls sideways.
const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15]
const FIT_MINIMUM = 0.8
const PADDING = 32

/** Width of an element, kept current as it resizes. Zero where it cannot be measured, as in tests. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/** A drawing of the steps. Arrows run from a step to the steps that rely on it. */
export function ReasoningGraph({ nodes, edges, flagged, selectedId, onSelect }: Props) {
  const layout = layoutGraph(nodes, edges)
  const position = new Map(layout.nodes.map((placed) => [placed.id, placed]))
  const [viewport, viewportWidth] = useWidth()
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const fitScale = viewportWidth > 0 ? Math.max(FIT_MINIMUM, Math.min(1, (viewportWidth - PADDING) / layout.width)) : 1
  const scale = zoom === 'fit' ? fitScale : zoom
  const zoomIndex = ZOOMS.findIndex((step) => step >= scale - 0.001)

  function stepZoom(direction: 1 | -1) {
    const index = zoomIndex === -1 ? ZOOMS.length - 1 : zoomIndex
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, index + direction))]
    setZoom(next)
  }
  const stepNumber = new Map(nodes.map((node, index) => [node.id, index + 1]))

  // Read after the visible text of a step, for screen reader users.
  function relations(node: ReasoningNode): string {
    const reliesOn = layout.links.filter((link) => link.to === node.id).map((link) => stepNumber.get(link.from))
    const parts = [reliesOn.length > 0 ? `Relies on step ${reliesOn.join(' and step ')}.` : 'Relies on no other step.']
    if (flagged.has(node.id)) parts.push('Hetu has a question about this step.')
    // Shown only to screen readers. On screen, the limitations below say it once for all steps.
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
      <div className="mb-2 flex items-center justify-end gap-1" role="group" aria-label="Zoom">
        <button
          type="button"
          className="btn btn-quiet btn-small px-2"
          onClick={() => stepZoom(-1)}
          disabled={scale <= ZOOMS[0] + 0.001}
        >
          Zoom out
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-small px-2"
          onClick={() => stepZoom(1)}
          disabled={scale >= ZOOMS.at(-1)! - 0.001}
        >
          Zoom in
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-small px-2"
          aria-pressed={zoom === 'fit'}
          onClick={() => setZoom('fit')}
        >
          Fit
        </button>
        <span aria-live="polite" className="w-11 text-right text-xs text-muted tabular-nums">
          {Math.round(scale * 100)}%
        </span>
      </div>
      <div
        ref={viewport}
        role="group"
        aria-label="Reasoning graph. Each step is a button. Arrows point from a step to the steps that rely on it."
        onKeyDown={moveFocus}
        className="graph-scroll overflow-x-auto overflow-y-hidden rounded-md border border-rule bg-surface px-4 py-6"
      >
        {/* The outer box takes the scaled size, so scrolling covers exactly the drawing. */}
        <div className="mx-auto" style={{ width: layout.width * scale, height: layout.height * scale }}>
          <div
            className="relative origin-top-left"
            style={{
              width: layout.width,
              height: layout.height,
              transform: scale === 1 ? undefined : `scale(${scale})`,
            }}
          >
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
                    {hasQuestion && (
                      <span className="rounded-full border border-flag px-1.5 text-[0.65rem] text-flag normal-case">
                        Question
                      </span>
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
