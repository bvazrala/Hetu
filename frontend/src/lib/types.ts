// TypeScript mirror of backend/app/schemas.py. Keep the two in step.
// Field names use snake_case because they match the JSON exactly.

export type NodeType = 'assumption' | 'claim' | 'inference' | 'conclusion'

/** Character offsets into the draft. `end` is exclusive. */
export interface Span {
  start: number
  end: number
}

export interface ReasoningNode {
  id: string
  type: NodeType
  text: string
  span: Span | null
}

/** `source` relies on `target`. */
export interface Edge {
  source: string
  target: string
  relation: 'depends_on'
}

export interface Observation {
  target: string
  issue_type: 'unjustified_step' | 'invalid_step'
  evidence: string
  verification: 'tool_verified' | 'not_verified'
  question: string
  hint: string | null
}

export interface Analysis {
  /** "sample" is hand-written fixture content. "live" is reserved for real results. */
  source: 'sample' | 'live'
  nodes: ReasoningNode[]
  edges: Edge[]
  observations: Observation[]
  limitations: string[]
}

export interface Example {
  id: string
  title: string
  problem: string
  draft: string
  expected: 'correct' | 'incomplete' | 'invalid'
  notes: string
  sample_analysis?: Analysis
}
