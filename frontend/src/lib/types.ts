// TypeScript mirror of backend/app/schemas.py. Keep the two in step.
// Field names use snake_case because they match the JSON exactly.

export type NodeType = 'assumption' | 'claim' | 'inference' | 'conclusion'

/** Offsets into the draft, counted in Unicode code points. `end` is exclusive. */
export interface Span {
  start: number
  end: number
}

export interface ReasoningNode {
  id: string
  type: NodeType
  text: string
  /** Null when the step's wording was not found in the draft. */
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

/** A student's disagreement with one question. Sent with a new analysis request. */
export interface Challenge {
  step_text: string
  question: string
  reason: string
}

export interface ChallengeResult {
  /** "withdrawn": the step is no longer questioned. "maintained": it still is. */
  outcome: 'withdrawn' | 'maintained'
  response: string
}

export interface Analysis {
  /** "sample" is hand-written fixture content. "live" is a model's result. */
  source: 'sample' | 'live'
  nodes: ReasoningNode[]
  edges: Edge[]
  observations: Observation[]
  limitations: string[]
  challenge?: ChallengeResult | null
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
