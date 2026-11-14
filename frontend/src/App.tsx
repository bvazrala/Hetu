import { useState } from 'react'
import { BackendStatus } from './components/BackendStatus'
import { ModeToggle, type Mode } from './components/ModeToggle'
import { StructuredView } from './features/reasoning/StructuredView'
import { FreeformEditor } from './features/workspace/FreeformEditor'
import { AnalyzeError, analyzeDraft } from './lib/api'
import { demoExample, findSampleAnalysis } from './lib/examples'
import type { Analysis } from './lib/types'

/** An analysis together with the exact text it was made for. */
interface Inspection {
  problem: string
  draft: string
  analysis: Analysis
  /** Set when live analysis failed and the hand-written sample is shown instead. */
  fallbackReason: string | null
}

export default function App() {
  // The student's work lives here, above both views, so switching views
  // can never alter it. Nothing below ever writes to `draft` except typing
  // and loading the example.
  const [problem, setProblem] = useState('')
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<Mode>('freeform')

  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // An analysis is shown only while it still matches what is written.
  const isCurrent = inspection !== null && inspection.problem === problem && inspection.draft === draft

  function loadExample() {
    setProblem(demoExample.problem)
    setDraft(demoExample.draft)
    setError(null)
    setMode('freeform')
  }

  async function inspect() {
    if (busy) return
    setBusy(true)
    setError(null)
    // Remember what was sent, in case the student keeps typing while waiting.
    const sent = { problem, draft }
    try {
      const analysis = await analyzeDraft(sent.problem, sent.draft)
      setInspection({ ...sent, analysis, fallbackReason: null })
      setMode('structured')
    } catch (caught) {
      const reason = caught instanceof AnalyzeError ? caught.message : 'The analysis could not be completed.'
      // The unedited example has a hand-written sample to fall back on.
      const sample = findSampleAnalysis(sent.problem, sent.draft)
      if (sample) {
        setInspection({ ...sent, analysis: sample, fallbackReason: reason })
        setMode('structured')
      } else {
        setError(reason)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-5 sm:px-8">
      <header className="flex items-center justify-between gap-4 border-b border-rule py-4">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Hetu</h1>
        <ModeToggle mode={mode} onChange={setMode} />
      </header>

      <main className="flex-1 py-8">
        <p className="mb-8 max-w-xl text-muted">
          A workspace for your own reasoning. Write an argument in your own words, then look at its steps.
        </p>

        {mode === 'freeform' ? (
          <FreeformEditor
            problem={problem}
            draft={draft}
            busy={busy}
            error={error}
            onProblemChange={setProblem}
            onDraftChange={setDraft}
            onLoadExample={loadExample}
            onInspect={inspect}
          />
        ) : (
          <StructuredView
            draft={draft}
            analysis={isCurrent ? inspection.analysis : null}
            stale={inspection !== null && !isCurrent}
            fallbackReason={isCurrent ? inspection.fallbackReason : null}
          />
        )}
      </main>

      <footer className="flex flex-col gap-1 border-t border-rule py-4 text-sm text-muted sm:flex-row sm:justify-between">
        <span>Prototype. Feedback comes from a model and can be wrong.</span>
        <BackendStatus />
      </footer>
    </div>
  )
}
