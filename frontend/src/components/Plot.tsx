import { useId, useMemo } from 'react'
import { buildPlot, PlotError, ticks, type PlotData } from '../lib/plot'

const WIDTH = 560
const HEIGHT = 340
const MARGIN = { top: 16, right: 20, bottom: 46, left: 58 }

// Each line differs in pattern as well as color, so they can be told apart without color.
const STYLES = [
  { stroke: 'var(--color-accent)', dash: undefined },
  { stroke: 'var(--color-flag)', dash: '7 5' },
  { stroke: 'var(--color-ink)', dash: '2 4' },
  { stroke: 'var(--color-muted)', dash: '10 4 2 4' },
]

function format(value: number): string {
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e5 || abs < 1e-3) return value.toExponential(1)
  return Number(value.toPrecision(4)).toString()
}

function describe(plot: PlotData): string {
  const lines = plot.series.map((series) => series.label).join('; ')
  const what = lines || `${plot.points.length} points`
  return `Graph of ${what}, for ${plot.xLabel} from ${format(plot.x[0])} to ${format(plot.x[1])}.`
}

/** A graph drawn from Hetu's description. Shows the description with the reason when it cannot be drawn. */
export function Plot({ source }: { source: string }) {
  const clipId = `plot-${useId().replace(/:/g, '')}`
  const result = useMemo(() => {
    try {
      return { plot: buildPlot(source), error: null }
    } catch (error) {
      return { plot: null, error: error instanceof PlotError ? error.message : 'The graph could not be drawn.' }
    }
  }, [source])

  if (!result.plot) {
    return (
      <div className="rounded-md border border-rule bg-surface px-4 py-3 text-sm">
        <p>
          <span className="font-medium">This graph could not be drawn.</span>{' '}
          <span className="text-muted">{result.error}</span>
        </p>
      </div>
    )
  }

  const plot = result.plot
  const innerW = WIDTH - MARGIN.left - MARGIN.right
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom
  const sx = (x: number) => MARGIN.left + ((x - plot.x[0]) / (plot.x[1] - plot.x[0])) * innerW
  const sy = (y: number) => MARGIN.top + (1 - (y - plot.y[0]) / (plot.y[1] - plot.y[0])) * innerH
  const xTicks = ticks(plot.x[0], plot.x[1])
  const yTicks = ticks(plot.y[0], plot.y[1], 5)
  const axisX = plot.y[0] <= 0 && plot.y[1] >= 0 ? sy(0) : null
  const axisY = plot.x[0] <= 0 && plot.x[1] >= 0 ? sx(0) : null

  return (
    <figure className="my-4 rounded-md border border-rule bg-surface p-3">
      {plot.title && <figcaption className="mb-1 font-sans text-sm font-medium">{plot.title}</figcaption>}
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={describe(plot)}
        className="h-auto w-full font-sans"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={MARGIN.left} y={MARGIN.top} width={innerW} height={innerH} />
          </clipPath>
        </defs>
        {xTicks.map((value) => (
          <g key={`x${value}`}>
            <line x1={sx(value)} x2={sx(value)} y1={MARGIN.top} y2={MARGIN.top + innerH} stroke="var(--color-rule)" />
            <text
              x={sx(value)}
              y={MARGIN.top + innerH + 16}
              textAnchor="middle"
              fontSize="11"
              fill="var(--color-muted)"
            >
              {format(value)}
            </text>
          </g>
        ))}
        {yTicks.map((value) => (
          <g key={`y${value}`}>
            <line x1={MARGIN.left} x2={MARGIN.left + innerW} y1={sy(value)} y2={sy(value)} stroke="var(--color-rule)" />
            <text x={MARGIN.left - 8} y={sy(value) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">
              {format(value)}
            </text>
          </g>
        ))}
        <rect x={MARGIN.left} y={MARGIN.top} width={innerW} height={innerH} fill="none" stroke="var(--color-rule)" />
        {axisX !== null && (
          <line x1={MARGIN.left} x2={MARGIN.left + innerW} y1={axisX} y2={axisX} stroke="var(--color-muted)" />
        )}
        {axisY !== null && (
          <line x1={axisY} x2={axisY} y1={MARGIN.top} y2={MARGIN.top + innerH} stroke="var(--color-muted)" />
        )}

        <g clipPath={`url(#${clipId})`}>
          {plot.series.map((series, index) =>
            series.runs.map((run, part) => (
              <polyline
                key={`${index}-${part}`}
                points={run.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ')}
                fill="none"
                stroke={STYLES[index % STYLES.length].stroke}
                strokeDasharray={STYLES[index % STYLES.length].dash}
                strokeWidth="2.25"
                strokeLinejoin="round"
              />
            )),
          )}
          {plot.points.map((point, index) => (
            <g key={`p${index}`}>
              <circle cx={sx(point.x)} cy={sy(point.y)} r="4" fill="var(--color-ink)" />
              {point.label && (
                <text
                  x={sx(point.x) + 7}
                  y={sy(point.y) - 7}
                  fontSize="12"
                  fill="var(--color-ink)"
                  stroke="var(--color-surface)"
                  strokeWidth="4"
                  paintOrder="stroke"
                >
                  {point.label}
                </text>
              )}
            </g>
          ))}
        </g>

        <text x={MARGIN.left + innerW / 2} y={HEIGHT - 8} textAnchor="middle" fontSize="12" fill="var(--color-ink)">
          {plot.xLabel}
        </text>
        {plot.yLabel && (
          <text
            transform={`translate(14 ${MARGIN.top + innerH / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize="12"
            fill="var(--color-ink)"
          >
            {plot.yLabel}
          </text>
        )}
      </svg>
      {plot.series.length > 0 && (
        <ul role="list" className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-sans text-xs text-muted">
          {plot.series.map((series, index) => (
            <li key={index} className="flex items-center gap-1.5">
              <svg width="26" height="8" aria-hidden="true">
                <line
                  x1="1"
                  x2="25"
                  y1="4"
                  y2="4"
                  stroke={STYLES[index % STYLES.length].stroke}
                  strokeDasharray={STYLES[index % STYLES.length].dash}
                  strokeWidth="2.25"
                />
              </svg>
              {series.label}
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}
