import fixture from '../../../examples/sample_proofs.json'
import type { Analysis, Example } from './types'

// The fixture is checked against the backend schema by backend/tests.
const examples = fixture.examples as Example[]

/** The example loaded by "Try an example". */
export const demoExample: Example = examples[0]

/**
 * Returns the hand-written sample analysis, but only when the problem and
 * draft are exactly an unedited example. Anything else returns null, so a
 * sample is never shown against work it was not written for.
 */
export function findSampleAnalysis(problem: string, draft: string): Analysis | null {
  const match = examples.find((e) => e.problem === problem && e.draft === draft)
  return match?.sample_analysis ?? null
}
