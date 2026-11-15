import { useEffect, useRef, useState } from 'react'
import type { Mode } from '../../components/ModeToggle'
import { AnalyzeError, analyzeDraft } from '../../lib/api'
import { demoExample, findSampleAnalysis } from '../../lib/examples'
import { toStringRange, type StringRange } from '../../lib/spans'
import { clearWorkspace, loadWorkspace, saveWorkspace } from '../../lib/storage'
import type { Analysis, Observation, ProofInspection, ReasoningNode } from '../../lib/types'

/** An analysis together with the exact text it was made for. */
export interface Inspection {
  problem: string
  draft: string
  analysis: Analysis
  /** Set when live analysis failed and the hand-written sample is shown instead. */
  fallbackReason: string | null
  /** The student's own words, when this analysis answers a challenge. */
  challengeReason: string | null
}

/** A request to put the cursor in the draft, optionally selecting a range. */
export interface FocusRequest {
  range: StringRange | null
}

export const DISCARDED_NOTICE =
  'Your draft changed while Hetu was reading it, so that analysis was discarded. Inspect again when you are ready.'

const SAVE_DELAY_MS = 400
const GENERIC_FAILURE = 'The analysis could not be completed.'

function failureMessage(error: unknown): string {
  return error instanceof AnalyzeError ? error.message : GENERIC_FAILURE
}

/**
 * Holds the student's work and everything known about it.
 *
 * The problem and draft live here, above every view. Only typing, loading
 * the example, opening a proof from the conversation, and clearing the
 * workspace ever write to them.
 */
export function useWorkspace() {
  const [saved] = useState(loadWorkspace)
  const [problem, setProblemState] = useState(saved?.problem ?? '')
  const [draft, setDraftState] = useState(saved?.draft ?? '')
  const [mode, setMode] = useState<Mode>('conversation')

  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [busy, setBusy] = useState<'inspect' | 'challenge' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [challengeError, setChallengeError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const [resultVersion, setResultVersion] = useState(0)

  // A response is compared against what is on screen when it arrives, not
  // against what was on screen when the request left. State captured by an
  // async function is the old value, so the newest text is kept in a ref.
  const latest = useRef({ problem, draft })
  // Raised whenever the workspace is replaced, so a response to an older
  // request can tell that it no longer belongs anywhere.
  const requestId = useRef(0)

  function setProblem(value: string) {
    latest.current.problem = value
    setProblemState(value)
  }

  function setDraft(value: string) {
    latest.current.draft = value
    setDraftState(value)
  }

  useEffect(() => {
    const timer = setTimeout(() => saveWorkspace({ problem, draft }), SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [problem, draft])

  const isCurrent = inspection !== null && inspection.problem === problem && inspection.draft === draft

  function replaceWorkspace(nextProblem: string, nextDraft: string) {
    requestId.current += 1
    setProblem(nextProblem)
    setDraft(nextDraft)
    setBusy(null)
    setError(null)
    setChallengeError(null)
    setNotice(null)
    setMode('freeform')
  }

  function loadExample() {
    replaceWorkspace(demoExample.problem, demoExample.draft)
  }

  function reset() {
    replaceWorkspace('', '')
    setInspection(null)
    clearWorkspace()
    setFocusRequest({ range: null })
  }

  /** True when the response to `sent` may still be shown. Explains itself to the student if not. */
  function stillWanted(id: number, sent: { problem: string; draft: string }): boolean {
    if (id !== requestId.current) return false
    setBusy(null)
    if (latest.current.problem === sent.problem && latest.current.draft === sent.draft) return true
    setNotice(DISCARDED_NOTICE)
    return false
  }

  async function inspect() {
    if (busy || draft.trim() === '') return
    const id = ++requestId.current
    const sent = { problem, draft }
    setBusy('inspect')
    setError(null)
    setChallengeError(null)
    setNotice(null)

    let analysis: Analysis
    let fallbackReason: string | null = null
    try {
      analysis = await analyzeDraft(sent.problem, sent.draft)
    } catch (caught) {
      const reason = failureMessage(caught)
      const sample = findSampleAnalysis(sent.problem, sent.draft)
      if (!stillWanted(id, sent)) return
      if (!sample) {
        setError(reason)
        return
      }
      analysis = sample
      fallbackReason = reason
    }
    if (fallbackReason === null && !stillWanted(id, sent)) return

    setInspection({ ...sent, analysis, fallbackReason, challengeReason: null })
    setResultVersion((version) => version + 1)
    setMode('structured')
  }

  /** Asks Hetu to reconsider one question in light of the student's reason. */
  async function challenge(node: ReasoningNode, observation: Observation, reason: string) {
    if (busy || !isCurrent || reason.trim() === '') return
    const id = ++requestId.current
    const sent = { problem, draft }
    setBusy('challenge')
    setChallengeError(null)

    let analysis: Analysis
    try {
      analysis = await analyzeDraft(sent.problem, sent.draft, {
        step_text: node.text,
        question: observation.question,
        reason,
      })
    } catch (caught) {
      // The earlier analysis stays on screen. Only the challenge failed.
      if (stillWanted(id, sent)) setChallengeError(failureMessage(caught))
      return
    }
    if (!stillWanted(id, sent)) return

    setInspection({ ...sent, analysis, fallbackReason: null, challengeReason: reason })
    setResultVersion((version) => version + 1)
  }

  /** Loads a proof that was inspected in the conversation, and shows its graph. */
  function openInspection({ problem: nextProblem, draft: nextDraft, analysis }: ProofInspection) {
    replaceWorkspace(nextProblem, nextDraft)
    setInspection({ problem: nextProblem, draft: nextDraft, analysis, fallbackReason: null, challengeReason: null })
    setResultVersion((version) => version + 1)
    setMode('structured')
  }

  /** Returns to the editor with the step's text selected, when Hetu knows where it is. */
  function reviseStep(node: ReasoningNode) {
    setMode('freeform')
    setFocusRequest({ range: isCurrent ? toStringRange(draft, node.span) : null })
  }

  return {
    problem,
    draft,
    mode,
    setMode,
    setProblem,
    setDraft,
    /** The latest analysis, or null if there is none or the text has changed since. */
    inspection: isCurrent ? inspection : null,
    /** True when an analysis exists but no longer matches the text. */
    stale: inspection !== null && !isCurrent,
    busy,
    error,
    challengeError,
    notice,
    focusRequest,
    /** Increases each time a new analysis is shown. Used to move focus to it. */
    resultVersion,
    inspect,
    challenge,
    reviseStep,
    openInspection,
    loadExample,
    reset,
  }
}

export type Workspace = ReturnType<typeof useWorkspace>
