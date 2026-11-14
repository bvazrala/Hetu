import { useState } from 'react'
import { BackendStatus } from './components/BackendStatus'
import { ModeToggle, type Mode } from './components/ModeToggle'
import { StructuredView } from './features/reasoning/StructuredView'
import { FreeformEditor } from './features/workspace/FreeformEditor'
import { demoExample, findSampleAnalysis } from './lib/examples'

export default function App() {
  // The student's work lives here, above both views, so switching views
  // can never alter it.
  const [problem, setProblem] = useState('')
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<Mode>('freeform')

  // Derived on each render. Non-null only for the unedited example.
  const sampleAnalysis = findSampleAnalysis(problem, draft)

  function loadExample() {
    setProblem(demoExample.problem)
    setDraft(demoExample.draft)
    setMode('freeform')
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
            canInspect={sampleAnalysis !== null}
            onProblemChange={setProblem}
            onDraftChange={setDraft}
            onLoadExample={loadExample}
            onInspect={() => setMode('structured')}
          />
        ) : (
          <StructuredView draft={draft} analysis={sampleAnalysis} onLoadExample={loadExample} />
        )}
      </main>

      <footer className="flex flex-col gap-1 border-t border-rule py-4 text-sm text-muted sm:flex-row sm:justify-between">
        <span>Prototype. Live analysis is not connected yet.</span>
        <BackendStatus />
      </footer>
    </div>
  )
}
