import { demoExample } from '../lib/examples'
import type { Analysis } from '../lib/types'

export const PROBLEM = demoExample.problem
export const DRAFT = demoExample.draft

/** The example's analysis, marked as a model result: three steps in a chain, with a question on the last. */
export const LIVE_ANALYSIS: Analysis = { ...demoExample.sample_analysis!, source: 'live' }

/** The same steps with no question. */
export const NO_GAP_ANALYSIS: Analysis = { ...LIVE_ANALYSIS, observations: [] }

/** A promise that the test settles by hand, to control when a request "returns". */
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
