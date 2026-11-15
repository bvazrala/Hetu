import type { NodeType } from './types'

export const TYPE_LABELS: Record<NodeType, string> = {
  assumption: 'Assumption',
  claim: 'Claim',
  inference: 'Inference',
  conclusion: 'Conclusion',
}
