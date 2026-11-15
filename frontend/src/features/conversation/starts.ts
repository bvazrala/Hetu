import type { Intent } from '../../lib/types'

/** A starting point offered on the first screen. */
export interface Start {
  intent: Intent
  title: string
  description: string
  /** Shown in the empty composer once this starting point is chosen. */
  placeholder: string
}

export const STARTS: Start[] = [
  {
    intent: 'understand',
    title: 'Understand something',
    description: 'An explanation, an example, or a different angle on an idea.',
    placeholder: 'What would you like to understand?',
  },
  {
    intent: 'solve',
    title: 'Work through a problem',
    description: 'Guidance while you solve it. The steps stay yours.',
    placeholder: 'What is the problem, and where are you stuck?',
  },
  {
    intent: 'examine',
    title: 'Examine my reasoning',
    description: 'Feedback on a proof, solution, explanation, or argument you wrote.',
    placeholder: 'Paste your reasoning, or say what you would like checked',
  },
]
