// Function plots that Hetu describes in a reply. The model writes a small
// JSON description; this file checks it and computes every point, so the
// graph is exact even when the model's arithmetic would not be.
//
// Expressions are parsed by a small grammar of arithmetic and named math
// functions. Nothing from the model is ever run as code.

export class PlotError extends Error {}

type Node =
  | { kind: 'number'; value: number }
  | { kind: 'variable' }
  | { kind: 'unary'; operand: Node }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] }

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
}
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E }
const MAX_EXPRESSION = 200
const MAX_DEPTH = 40

/** Parses an expression in one variable. Throws PlotError with a readable reason. */
export function parseExpression(source: string, variable: string): (x: number) => number {
  if (source.length > MAX_EXPRESSION) throw new PlotError('The expression is too long.')
  const tokens = source.match(/\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[A-Za-z_]\w*|\*\*|[-+*/^(),]|\S/g) ?? []
  let position = 0
  let depth = 0

  const peek = () => tokens[position]
  const take = (expected?: string) => {
    const token = tokens[position]
    if (expected !== undefined && token !== expected) throw new PlotError(`Expected "${expected}" in "${source}".`)
    position++
    return token
  }
  const nest = <T>(read: () => T): T => {
    if (++depth > MAX_DEPTH) throw new PlotError('The expression is nested too deeply.')
    const result = read()
    depth--
    return result
  }

  function sum(): Node {
    let left = product()
    while (peek() === '+' || peek() === '-') {
      const op = take() as '+' | '-'
      left = { kind: 'binary', op, left, right: product() }
    }
    return left
  }

  // A number or closing bracket followed directly by a name or bracket
  // multiplies, so "2x" and "3(x+1)" read as they do on paper.
  function startsFactor(token: string | undefined) {
    return token !== undefined && (token === '(' || /^[A-Za-z_\d.]/.test(token))
  }

  function product(): Node {
    let left = unary()
    for (;;) {
      if (peek() === '*' || peek() === '/') {
        const op = take() as '*' | '/'
        left = { kind: 'binary', op, left, right: unary() }
      } else if (startsFactor(peek())) {
        left = { kind: 'binary', op: '*', left, right: power() }
      } else return left
    }
  }

  function unary(): Node {
    if (peek() === '-') {
      take()
      return nest(() => ({ kind: 'unary', operand: unary() }))
    }
    if (peek() === '+') {
      take()
      return nest(unary)
    }
    return power()
  }

  function power(): Node {
    const base = primary()
    if (peek() === '^' || peek() === '**') {
      take()
      return { kind: 'binary', op: '^', left: base, right: nest(unary) }
    }
    return base
  }

  function primary(): Node {
    const token = take()
    if (token === undefined) throw new PlotError(`"${source}" ends too early.`)
    if (token === '(') {
      const inner = nest(sum)
      take(')')
      return inner
    }
    if (/^[\d.]/.test(token)) {
      const value = Number(token)
      if (!Number.isFinite(value)) throw new PlotError(`"${token}" is not a number.`)
      return { kind: 'number', value }
    }
    if (/^[A-Za-z_]/.test(token)) {
      const name = token.toLowerCase()
      if (token === variable) return { kind: 'variable' }
      if (name in FUNCTIONS) {
        take('(')
        const args = [nest(sum)]
        while (peek() === ',') {
          take()
          args.push(nest(sum))
        }
        take(')')
        return { kind: 'call', name, args }
      }
      if (name in CONSTANTS) return { kind: 'number', value: CONSTANTS[name] }
      throw new PlotError(`"${token}" is not a known name. The variable is "${variable}".`)
    }
    throw new PlotError(`Unexpected "${token}" in "${source}".`)
  }

  const tree = sum()
  if (position < tokens.length) throw new PlotError(`Unexpected "${tokens[position]}" in "${source}".`)

  const evaluate = (node: Node, x: number): number => {
    switch (node.kind) {
      case 'number':
        return node.value
      case 'variable':
        return x
      case 'unary':
        return -evaluate(node.operand, x)
      case 'call':
        return FUNCTIONS[node.name](...node.args.map((arg) => evaluate(arg, x)))
      case 'binary': {
        const a = evaluate(node.left, x)
        const b = evaluate(node.right, x)
        if (node.op === '+') return a + b
        if (node.op === '-') return a - b
        if (node.op === '*') return a * b
        if (node.op === '/') return a / b
        return a ** b
      }
    }
  }
  return (x: number) => evaluate(tree, x)
}

export interface Series {
  label: string
  /** Runs of points between breaks, such as at an asymptote. */
  runs: [number, number][][]
}

export interface PlotData {
  title: string | null
  xLabel: string
  yLabel: string
  x: [number, number]
  y: [number, number]
  series: Series[]
  points: { x: number; y: number; label: string | null }[]
}

const SAMPLES = 400
const MAX_FUNCTIONS = 4
const MAX_POINTS = 40

function finite(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new PlotError(`${what} must be a number.`)
  return value
}

function range(value: unknown, what: string): [number, number] | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value) || value.length !== 2) throw new PlotError(`${what} must be [low, high].`)
  const low = finite(value[0], what)
  const high = finite(value[1], what)
  if (!(high > low)) throw new PlotError(`${what} must go from a lower to a higher number.`)
  return [low, high]
}

function text(value: unknown, max = 80): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

/**
 * Checks a plot description and computes its points.
 *
 *   {
 *     "title": "Position over time",           optional
 *     "variable": "t",                          optional, default "x"
 *     "x": [0, 4],  "y": [0, 20],               y is optional
 *     "xLabel": "t (s)", "yLabel": "s (m)",     optional
 *     "functions": [{ "expr": "2*t^2", "label": "s = 2t²" }],
 *     "points": [{ "x": 2, "y": 8, "label": "(2, 8)" }]   optional
 *   }
 */
export function buildPlot(source: string): PlotData {
  let spec: Record<string, unknown>
  try {
    spec = JSON.parse(source)
  } catch {
    throw new PlotError('The graph description is not valid JSON.')
  }
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec))
    throw new PlotError('The graph description must be an object.')

  const variable = text(spec.variable, 12) ?? 'x'
  if (!/^[A-Za-z_]\w*$/.test(variable) || variable.toLowerCase() in FUNCTIONS || variable.toLowerCase() in CONSTANTS) {
    throw new PlotError(`"${variable}" cannot be used as the variable.`)
  }
  const x = range(spec.x, 'The x range')
  if (!x) throw new PlotError('The graph needs an x range, such as "x": [-2, 2].')
  const functions = Array.isArray(spec.functions) ? spec.functions.slice(0, MAX_FUNCTIONS) : []
  const rawPoints = Array.isArray(spec.points) ? spec.points.slice(0, MAX_POINTS) : []
  if (functions.length === 0 && rawPoints.length === 0) throw new PlotError('The graph has nothing to draw.')

  const samples: { label: string; values: [number, number][] }[] = functions.map((entry: unknown, index: number) => {
    const item = (typeof entry === 'string' ? { expr: entry } : entry) as Record<string, unknown>
    const expr = text(item?.expr, MAX_EXPRESSION)
    if (!expr) throw new PlotError(`Function ${index + 1} has no expression.`)
    const f = parseExpression(expr, variable)
    const values: [number, number][] = []
    for (let i = 0; i <= SAMPLES; i++) {
      const at = x[0] + ((x[1] - x[0]) * i) / SAMPLES
      values.push([at, f(at)])
    }
    return { label: text(item.label) ?? `${variable === 'x' ? 'y' : 'f'} = ${expr}`, values }
  })

  const points = rawPoints.map((entry: unknown) => {
    const item = entry as Record<string, unknown>
    return { x: finite(item?.x, 'A point'), y: finite(item?.y, 'A point'), label: text(item?.label, 40) }
  })

  let y = range(spec.y, 'The y range')
  if (!y) {
    // Leave out the most extreme values, so an asymptote does not flatten the rest.
    const ys = [...samples.flatMap((s) => s.values.map(([, value]) => value)), ...points.map((p) => p.y)]
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
    if (ys.length === 0) throw new PlotError('The functions have no values in this range.')
    const trim = samples.length > 0 ? Math.floor(ys.length * 0.02) : 0
    let low = ys[trim]
    let high = ys[ys.length - 1 - trim]
    if (high - low < 1e-9) {
      low -= 1
      high += 1
    }
    const pad = (high - low) * 0.08
    y = [low - pad, high + pad]
  }

  const span = y[1] - y[0]
  const series = samples.map(({ label, values }) => {
    const runs: [number, number][][] = []
    let run: [number, number][] = []
    for (const [at, value] of values) {
      const outside = !Number.isFinite(value) || value < y![0] - span * 2 || value > y![1] + span * 2
      const previous = run.at(-1)
      // A jump across most of the view between neighbouring samples is an asymptote, not a line.
      const jump = previous !== undefined && Math.abs(value - previous[1]) > span * 0.9
      if (outside || jump) {
        if (run.length > 1) runs.push(run)
        run = outside ? [] : [[at, value]]
      } else run.push([at, value])
    }
    if (run.length > 1) runs.push(run)
    return { label, runs }
  })

  return {
    title: text(spec.title),
    xLabel: text(spec.xLabel, 40) ?? variable,
    yLabel: text(spec.yLabel, 40) ?? '',
    x,
    y,
    series,
    points,
  }
}

/** Evenly spaced tick values at round numbers, about `count` of them. */
export function ticks(low: number, high: number, count = 6): number[] {
  const raw = (high - low) / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10
  const out: number[] = []
  for (let value = Math.ceil(low / step) * step; value <= high + step * 1e-9; value += step) {
    out.push(Math.abs(value) < step * 1e-9 ? 0 : Number(value.toPrecision(12)))
  }
  return out
}
