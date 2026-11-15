import { describe, expect, it } from 'vitest'
import { layoutGraph, toLinks } from './graph'
import type { Edge, ReasoningNode } from './types'

function node(id: string): ReasoningNode {
  return { id, type: 'claim', text: id, span: null }
}

function dependsOn(source: string, target: string): Edge {
  return { source, target, relation: 'depends_on' }
}

describe('toLinks', () => {
  it('points the arrow from the prerequisite to the step that relies on it', () => {
    // The API says: n2 depends on n1. Reasoning flows n1 -> n2.
    const links = toLinks([node('n1'), node('n2')], [dependsOn('n2', 'n1')])
    expect(links).toEqual([{ from: 'n1', to: 'n2' }])
  })

  it('drops edges to unknown steps, self references, and repeats', () => {
    const nodes = [node('n1'), node('n2')]
    const edges = [dependsOn('n2', 'n1'), dependsOn('n2', 'n1'), dependsOn('n2', 'n9'), dependsOn('n1', 'n1')]
    expect(toLinks(nodes, edges)).toEqual([{ from: 'n1', to: 'n2' }])
  })
})

describe('layoutGraph', () => {
  it('places each step below everything it relies on', () => {
    const nodes = [node('n1'), node('n2'), node('n3')]
    const layout = layoutGraph(nodes, [dependsOn('n2', 'n1'), dependsOn('n3', 'n2')])
    const y = Object.fromEntries(layout.nodes.map((placed) => [placed.id, placed.y]))
    expect(y.n1).toBeLessThan(y.n2)
    expect(y.n2).toBeLessThan(y.n3)
  })

  it('starts each arrow at the prerequisite and ends it at the dependent step', () => {
    const layout = layoutGraph([node('n1'), node('n2')], [dependsOn('n2', 'n1')])
    const [link] = layout.links
    const from = layout.nodes.find((placed) => placed.id === 'n1')!
    const to = layout.nodes.find((placed) => placed.id === 'n2')!
    const numbers = link.path.match(/-?\d+(\.\d+)?/g)!.map(Number)
    // The path starts on the bottom edge of n1 and ends on the top edge of n2.
    expect(numbers[1]).toBeGreaterThan(from.y)
    expect(numbers.at(-1)).toBe(to.y)
  })

  it('puts steps that rely on nothing side by side in the first row', () => {
    const layout = layoutGraph([node('n1'), node('n2'), node('n3')], [dependsOn('n3', 'n1'), dependsOn('n3', 'n2')])
    const [first, second, third] = layout.nodes
    expect(first.row).toBe(0)
    expect(second.row).toBe(0)
    expect(first.x).not.toBe(second.x)
    expect(third.row).toBe(1)
  })

  it('keeps a step with no connections instead of dropping it', () => {
    const layout = layoutGraph([node('n1'), node('n2'), node('alone')], [dependsOn('n2', 'n1')])
    expect(layout.nodes.map((placed) => placed.id)).toEqual(['n1', 'n2', 'alone'])
    expect(layout.links).toHaveLength(1)
  })

  it('widens the drawing for an arrow that passes over a row', () => {
    const nodes = [node('n1'), node('n2'), node('n3')]
    const chain = layoutGraph(nodes, [dependsOn('n2', 'n1'), dependsOn('n3', 'n2')])
    const withSkip = layoutGraph(nodes, [dependsOn('n2', 'n1'), dependsOn('n3', 'n2'), dependsOn('n3', 'n1')])
    expect(withSkip.links).toHaveLength(3)
    expect(withSkip.width).toBeGreaterThan(chain.width)
  })

  it('does not loop forever on a cycle', () => {
    const layout = layoutGraph([node('n1'), node('n2')], [dependsOn('n1', 'n2'), dependsOn('n2', 'n1')])
    expect(layout.nodes).toHaveLength(2)
  })

  it('handles an analysis with no steps', () => {
    expect(layoutGraph([], [])).toMatchObject({ nodes: [], links: [], height: 0 })
  })
})
