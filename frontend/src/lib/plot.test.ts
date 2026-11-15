import { describe, expect, it } from 'vitest'
import { buildPlot, parseExpression, PlotError, ticks } from './plot'

describe('parseExpression', () => {
  it.each([
    ['2*x^2', 3, 18],
    ['2x^2', 3, 18],
    ['-x^2', 3, -9],
    ['2^3^2', 0, 512],
    ['3(x+1)', 1, 6],
    ['sqrt(x) + abs(-2)', 9, 5],
    ['sin(pi/2)', 0, 1],
    ['ln(e)', 0, 1],
    ['log(100)', 0, 2],
    ['max(x, 4)', 2, 4],
    ['x**2', 4, 16],
  ])('reads %s at %d as %d', (source, x, expected) => {
    expect(parseExpression(source, 'x')(x)).toBeCloseTo(expected)
  })

  it('uses the variable it was given', () => {
    expect(parseExpression('0.5*4*t^2', 't')(2)).toBeCloseTo(8)
    expect(() => parseExpression('x + 1', 't')).toThrow(PlotError)
  })

  it.each(['alert(1)', 'constructor', 'x; x', 'x +', '(x', 'fetch("/")', 'window', '__proto__', 'x'.repeat(201)])(
    'rejects %s',
    (source) => {
      expect(() => parseExpression(source, 'x')).toThrow(PlotError)
    },
  )
})

describe('buildPlot', () => {
  it('computes points across the range and labels the axes', () => {
    const plot = buildPlot('{"variable": "t", "x": [0, 4], "xLabel": "t (s)", "functions": [{"expr": "2*t^2", "label": "s = 2t²"}]}')
    expect(plot.xLabel).toBe('t (s)')
    expect(plot.series[0].label).toBe('s = 2t²')
    const run = plot.series[0].runs[0]
    expect(run[0]).toEqual([0, 0])
    expect(run.at(-1)![1]).toBeCloseTo(32)
    expect(plot.y[0]).toBeLessThan(0)
    expect(plot.y[1]).toBeGreaterThan(32)
  })

  it('breaks the line at an asymptote instead of joining across it', () => {
    const plot = buildPlot('{"x": [-2, 2], "y": [-10, 10], "functions": ["1/x"]}')
    expect(plot.series[0].runs.length).toBe(2)
    expect(plot.series[0].runs.every((run) => run.every(([x]) => x !== 0))).toBe(true)
  })

  it('draws points without functions', () => {
    const plot = buildPlot('{"x": [0, 3], "points": [{"x": 1, "y": 2, "label": "A"}]}')
    expect(plot.points).toEqual([{ x: 1, y: 2, label: 'A' }])
  })

  it.each([
    ['not json', 'not valid JSON'],
    ['{"functions": ["x"]}', 'needs an x range'],
    ['{"x": [2, 1], "functions": ["x"]}', 'lower to a higher'],
    ['{"x": [0, 1]}', 'nothing to draw'],
    ['{"x": [0, 1], "variable": "sin", "functions": ["x"]}', 'cannot be used'],
  ])('explains a bad description: %s', (source, reason) => {
    expect(() => buildPlot(source)).toThrow(reason)
  })
})

describe('ticks', () => {
  it('chooses round steps', () => {
    expect(ticks(0, 10)).toEqual([0, 2, 4, 6, 8, 10])
    expect(ticks(-1, 1, 4)).toEqual([-1, -0.5, 0, 0.5, 1])
  })
})
