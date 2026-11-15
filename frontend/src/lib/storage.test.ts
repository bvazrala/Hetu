import { describe, expect, it, vi } from 'vitest'
import { MAX_DRAFT_CHARS } from './api'
import { clearWorkspace, loadWorkspace, saveWorkspace } from './storage'

const KEY = 'hetu.workspace.v1'

describe('workspace storage', () => {
  it('restores what was saved', () => {
    expect(saveWorkspace({ problem: 'Prove it.', draft: 'Assume n² = 2k.' })).toBe(true)
    expect(loadWorkspace()).toEqual({ problem: 'Prove it.', draft: 'Assume n² = 2k.' })
  })

  it('returns null when nothing was saved', () => {
    expect(loadWorkspace()).toBeNull()
  })

  it('ignores damaged or unexpected data', () => {
    for (const bad of ['{not json', '"a string"', 'null', '{"problem": 1, "draft": "x"}', '[]']) {
      window.localStorage.setItem(KEY, bad)
      expect(loadWorkspace()).toBeNull()
    }
  })

  it('trims an oversized entry to the input limit', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ problem: '', draft: 'x'.repeat(MAX_DRAFT_CHARS + 50) }))
    expect(loadWorkspace()!.draft).toHaveLength(MAX_DRAFT_CHARS)
  })

  it('removes the entry when the workspace is empty or cleared', () => {
    saveWorkspace({ problem: 'p', draft: 'd' })
    saveWorkspace({ problem: '', draft: '' })
    expect(window.localStorage.getItem(KEY)).toBeNull()

    saveWorkspace({ problem: 'p', draft: 'd' })
    clearWorkspace()
    expect(loadWorkspace()).toBeNull()
  })

  it('fails quietly when the browser refuses storage', () => {
    const refuse = () => {
      throw new DOMException('denied', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse)

    expect(loadWorkspace()).toBeNull()
    expect(saveWorkspace({ problem: 'p', draft: 'd' })).toBe(false)
    expect(() => clearWorkspace()).not.toThrow()
  })
})
