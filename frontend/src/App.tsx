import { useEffect, useRef } from 'react'
import { BackendStatus } from './components/BackendStatus'
import { ModeToggle } from './components/ModeToggle'
import { Conversation } from './features/conversation/Conversation'
import { useConversation } from './features/conversation/useConversation'
import { StructuredView } from './features/reasoning/StructuredView'
import { FreeformEditor } from './features/workspace/FreeformEditor'
import { useWorkspace } from './features/workspace/useWorkspace'

export default function App() {
  const workspace = useWorkspace()
  const conversation = useConversation()

  // When a new analysis is shown, keyboard and screen reader users should land on it.
  const resultHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (workspace.resultVersion > 0) resultHeading.current?.focus()
  }, [workspace.resultVersion])

  const draft = workspace.draft.trim() === '' ? null : { problem: workspace.problem, draft: workspace.draft }

  function discussDraft() {
    if (!draft) return
    conversation.send('Can you look at the work in my workspace?', draft)
    workspace.setMode('conversation')
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-5 sm:px-8">
      <a
        href="#main"
        className="sr-only rounded-md bg-surface px-4 py-2 font-medium text-accent focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-10"
      >
        Skip to main content
      </a>
      <header className="flex flex-col gap-3 border-b border-rule py-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Hetu</h1>
        <ModeToggle mode={workspace.mode} onChange={workspace.setMode} />
      </header>

      <main id="main" tabIndex={-1} className="flex flex-1 flex-col pt-8">
        {workspace.mode === 'conversation' && (
          <Conversation conversation={conversation} workspace={draft} onOpenInspection={workspace.openInspection} />
        )}
        {workspace.mode === 'freeform' && (
          <div className="pb-8">
            <FreeformEditor
              problem={workspace.problem}
              draft={workspace.draft}
              busy={workspace.busy !== null}
              error={workspace.error}
              notice={workspace.notice}
              focusRequest={workspace.focusRequest}
              onProblemChange={workspace.setProblem}
              onDraftChange={workspace.setDraft}
              onLoadExample={workspace.loadExample}
              onInspect={workspace.inspect}
              onDiscuss={discussDraft}
              onReset={workspace.reset}
            />
          </div>
        )}
        {workspace.mode === 'structured' && (
          <div className="pb-8">
            <StructuredView
              // A new analysis starts with its own selection.
              key={workspace.resultVersion}
              draft={workspace.draft}
              inspection={workspace.inspection}
              stale={workspace.stale}
              busy={workspace.busy}
              error={workspace.error}
              challengeError={workspace.challengeError}
              headingRef={resultHeading}
              onInspect={workspace.inspect}
              onRevise={workspace.reviseStep}
              onChallenge={workspace.challenge}
            />
          </div>
        )}
      </main>

      <footer className="flex flex-col gap-1 border-t border-rule py-4 text-sm text-muted sm:flex-row sm:justify-between">
        <span>Prototype. Hetu is a language model and can be wrong.</span>
        <BackendStatus />
      </footer>
    </div>
  )
}
