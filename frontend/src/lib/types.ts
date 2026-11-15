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

export type Specialist = 'mathematics' | 'science' | 'programming' | 'humanities' | 'logic'

export interface ChatMessage {
  role: 'student' | 'hetu'
  content: string
}

/** Rough notes about one session. They are estimates, not measurements. */
export interface LearningState {
  topic: string | null
  goal: string | null
  concepts: string[]
  /** Only what the student has shown in their own messages. */
  understood: string[]
  /** Possible mix-ups. Uncertain. */
  misconceptions: string[]
  /** Questions the student is still exploring. */
  open_questions: string[]
  /** Notes the student removed. Hetu does not add them back. */
  dismissed: string[]
}

/** The kind of help the student asks for with one message. */
export type Assist = 'explain' | 'hint' | 'check' | 'example' | 'try' | 'challenge'

/** What the student came to do when the session started. */
export type Intent = 'understand' | 'solve' | 'examine'

export interface WorkspaceContext {
  problem: string
  draft: string
}

/** The open question from the latest proof inspection. */
export interface ProofContext {
  problem: string
  draft: string
  step_text: string
  question: string
}

export interface ChatRequest {
  messages: ChatMessage[]
  learning_state: LearningState | null
  workspace?: WorkspaceContext
  proof_context?: ProofContext
  assist?: Assist
  intent?: Intent
}

/** A proof analysis together with the exact text it was made for. */
export interface ProofInspection {
  problem: string
  draft: string
  analysis: Analysis
}

/** The result of one deterministic check. Computed, not a model's opinion. */
export interface ToolCheck {
  tool: string
  result: string
}

export interface ChatResponse {
  reply: string
  action: string
  specialists: Specialist[]
  learning_state: LearningState
  inspection: ProofInspection | null
  checks: ToolCheck[]
}
