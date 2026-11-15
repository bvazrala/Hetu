// Turns an analysis into positions for a drawing. No DOM measurement is
// involved: every node has the same fixed size, so the layout is a pure
// function of the data and can be tested without a browser.

import type { Edge, ReasoningNode } from './types'

/** One arrow in the drawing. It points from a step to a step that relies on it. */
export interface Link {
  from: string
  to: string
}

export interface PlacedNode {
  id: string
  row: number
  x: number
  y: number
}

export interface PlacedLink extends Link {
  /** SVG path data. */
  path: string
}

export interface GraphLayout {
  width: number
  height: number
  nodes: PlacedNode[]
  links: PlacedLink[]
}

export const NODE_WIDTH = 196
export const NODE_HEIGHT = 88
const GAP_X = 24
const GAP_Y = 48
// Arrows that pass over one or more rows run down a lane at the right edge.
// Each gets its own track so they do not draw on top of each other.
const LANE_MARGIN = 18
const LANE_TRACK = 10
const CORNER = 8

/**
 * Converts API edges into arrows.
 *
 * An API edge says "`source` relies on `target`". Reasoning flows the other
 * way, from what is relied on to what follows from it, so the arrow runs
 * from `target` to `source`. Edges that name unknown steps, point at
 * themselves, or repeat an earlier edge are dropped.
 */
export function toLinks(nodes: ReasoningNode[], edges: Edge[]): Link[] {
  const known = new Set(nodes.map((node) => node.id))
  const seen = new Set<string>()
  const links: Link[] = []
  for (const edge of edges) {
    if (!known.has(edge.source) || !known.has(edge.target) || edge.source === edge.target) continue
    const key = `${edge.target}>${edge.source}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ from: edge.target, to: edge.source })
  }
  return links
}

/** Row of each step: 0 if it relies on nothing, otherwise one below its lowest prerequisite. */
function assignRows(nodes: ReasoningNode[], links: Link[]): Map<string, number> {
  const prerequisites = new Map<string, string[]>()
  for (const link of links) {
    prerequisites.set(link.to, [...(prerequisites.get(link.to) ?? []), link.from])
  }

  const rows = new Map<string, number>()
  const visiting = new Set<string>()
  function rowOf(id: string): number {
    const known = rows.get(id)
    if (known !== undefined) return known
    // The API never sends a cycle, but a hand-edited fixture could. Treating
    // a step that is already being visited as a root breaks the loop.
    if (visiting.has(id)) return -1
    visiting.add(id)
    const above = (prerequisites.get(id) ?? []).map(rowOf)
    visiting.delete(id)
    const row = above.length > 0 ? Math.max(...above) + 1 : 0
    rows.set(id, row)
    return row
  }
  for (const node of nodes) rowOf(node.id)
  return rows
}

/**
 * Places steps in rows, with each step below everything it relies on.
 * Steps keep their original order within a row, and rows are centered.
 */
export function layoutGraph(nodes: ReasoningNode[], edges: Edge[]): GraphLayout {
  const links = toLinks(nodes, edges)
  const rowOf = assignRows(nodes, links)

  const rows: string[][] = []
  for (const node of nodes) {
    const row = rowOf.get(node.id) ?? 0
    ;(rows[row] ??= []).push(node.id)
  }

  const widest = Math.max(1, ...rows.map((row) => row.length))
  const contentWidth = widest * NODE_WIDTH + (widest - 1) * GAP_X

  const placed = new Map<string, PlacedNode>()
  rows.forEach((ids, row) => {
    const rowWidth = ids.length * NODE_WIDTH + (ids.length - 1) * GAP_X
    const offset = (contentWidth - rowWidth) / 2
    ids.forEach((id, column) => {
      placed.set(id, { id, row, x: offset + column * (NODE_WIDTH + GAP_X), y: row * (NODE_HEIGHT + GAP_Y) })
    })
  })

  let laneTracks = 0
  const placedLinks: PlacedLink[] = []
  for (const link of links) {
    const from = placed.get(link.from)
    const to = placed.get(link.to)
    if (!from || !to) continue

    if (to.row - from.row === 1) {
      // Neighbouring rows: bottom centre of one step to top centre of the next.
      const x1 = from.x + NODE_WIDTH / 2
      const y1 = from.y + NODE_HEIGHT
      const x2 = to.x + NODE_WIDTH / 2
      const y2 = to.y
      const bend = GAP_Y / 2
      placedLinks.push({ ...link, path: `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}` })
    } else {
      // Further apart. A straight line would cross the steps in between, so
      // the arrow drops into the empty band under its row, runs to the lane
      // at the right edge, goes down, and enters the target from the side.
      const track = laneTracks++
      const x1 = from.x + NODE_WIDTH / 2
      const y1 = from.y + NODE_HEIGHT
      const bandY = y1 + Math.min(GAP_Y - CORNER, 12 + track * 6)
      const laneX = contentWidth + LANE_MARGIN + track * LANE_TRACK
      const x2 = to.x + NODE_WIDTH
      const y2 = to.y + NODE_HEIGHT / 2
      const r = CORNER
      placedLinks.push({
        ...link,
        path:
          `M ${x1} ${y1} V ${bandY - r} Q ${x1} ${bandY}, ${x1 + r} ${bandY} ` +
          `H ${laneX - r} Q ${laneX} ${bandY}, ${laneX} ${bandY + r} ` +
          `V ${y2 - r} Q ${laneX} ${y2}, ${laneX - r} ${y2} H ${x2}`,
      })
    }
  }

  return {
    width: contentWidth + (laneTracks > 0 ? LANE_MARGIN + laneTracks * LANE_TRACK : 0),
    height: rows.length * NODE_HEIGHT + Math.max(0, rows.length - 1) * GAP_Y,
    nodes: nodes.map((node) => placed.get(node.id)!),
    links: placedLinks,
  }
}
