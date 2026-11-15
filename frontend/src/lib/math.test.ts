import { describe, expect, it } from 'vitest'
import { splitMath } from './math'

const mathParts = (text: string) => splitMath(text).filter((segment) => segment.math).map((segment) => segment.value)

describe('splitMath', () => {
  it('finds math between dollar signs', () => {
    expect(mathParts('Why does $n = \\sqrt{2k}$ imply that $n$ is even?')).toEqual(['n = \\sqrt{2k}', 'n'])
  })

  it('leaves prices alone', () => {
    expect(mathParts('It costs $5 and $6.')).toEqual([])
  })

  it('typesets a command that was written without dollar signs', () => {
    expect(mathParts('the product n\\,(n+1) and \\sqrt{2k}')).toEqual(['\\,', '\\sqrt{2k}'])
  })

  it('returns plain text unchanged', () => {
    expect(splitMath('so n must be even.')).toEqual([
      { math: false, value: 'so n must be even.', raw: 'so n must be even.', display: false },
    ])
  })
})
