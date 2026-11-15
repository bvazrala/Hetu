import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AccountDialog } from './features/account/AccountDialog'
import { AuthDialog } from './features/account/AuthDialog'
import { useAccount } from './features/account/useAccount'
import { Conversation } from './features/conversation/Conversation'
import { useConversation, type SaveState } from './features/conversation/useConversation'
import { HistoryPanel } from './features/history/HistoryPanel'
import { useHistory } from './features/history/useHistory'
import { StructuredView } from './features/reasoning/StructuredView'
import { FreeformEditor } from './features/workspace/FreeformEditor'
import { useWorkspace, type WorkspaceSave } from './features/workspace/useWorkspace'
import { WorkspacePanel } from './features/workspace/WorkspacePanel'
import { setTokenProvider } from './lib/api'
import { accessToken } from './lib/neon'
import { store as accountStore } from './lib/store'
import { useMediaQuery } from './lib/useMediaQuery'

// A signed-in student's requests count against their own account's limit.
setTokenProvider(accessToken)

/** Turns text into a Markdown quotation, so the student's question can follow it. */
function quote(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

const CONVERSATION_SAVE: Record<SaveState, string> = {
  off: 'Not saved. A guest conversation ends when you leave.',
  local: 'Kept in this tab only.',
  ask: 'Not saved yet.',
  saving: 'Saving…',
  saved: 'Saved to your account.',
  error: 'Not saved.',
}

const WORKSPACE_SAVE: Record<WorkspaceSave, string> = {
  off: 'Not saved. Stays in this tab.',
  local: 'Kept in this tab only.',
  ask: 'Not saved yet.',
  saving: 'Saving…',
  saved: 'Saved to your account',
  error: 'Not saved. Saving is unavailable right now.',
}

/**
 * One learning session. The conversation is always there; the workspace
 * opens beside it on wide screens, or in its place on narrow ones. A
 * signed-in student also has their saved conversations in a sidebar.
 */
export default function App() {
  const account = useAccount()
  const signedIn = account.status === 'signed-in'
  const store = signedIn ? accountStore : null

  const workspace = useWorkspace(store)
  const conversation = useConversation(store)
  const history = useHistory(
    store,
    account.user?.id ?? null,
    `${conversation.conversationId}:${conversation.saveState === 'saved' ? conversation.turns.length : ''}`,
  )

  const [authOpen, setAuthOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [savedName, setDisplayName] = useState<string | null>(null)
  const displayName = store ? savedName : null

  // Matches Tailwind's lg breakpoint, where panels sit beside the conversation.
  const sideBySide = useMediaQuery('(min-width: 64rem)')

  useEffect(() => {
    if (!store) return
    store
      .loadDisplayName()
      .then(setDisplayName)
      .catch(() => setDisplayName(null))
  }, [store])

  // When a new analysis is shown, keyboard and screen reader users should land on it.
  const resultHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (workspace.resultVersion > 0) resultHeading.current?.focus()
  }, [workspace.resultVersion])

  const draft = workspace.draft.trim() === '' ? null : { problem: workspace.problem, draft: workspace.draft }
  const panelOpen = workspace.panel !== null
  const showHistory = signedIn && (sideBySide || historyOpen)
  const conversationHidden = !sideBySide && (panelOpen || historyOpen)

  /** On a narrow screen, go back to the conversation so the student sees what happens there. */
  function showConversation() {
    if (sideBySide) return
    workspace.setPanel(null)
    setHistoryOpen(false)
  }

  function getFeedback() {
    if (!draft) return
    conversation.send('Can you give me feedback on the work in my workspace?', { workspace: draft, assist: 'check' })
    showConversation()
  }

  function askAbout(text: string) {
    conversation.compose(`${quote(text)}\n\n`, { attachWorkspace: true })
    showConversation()
  }

  const name = displayName ?? account.user?.name ?? account.user?.email ?? ''
  const askingToSave = conversation.saveState === 'ask' || workspace.save === 'ask'

  const notices: ReactNode[] = []
  if (askingToSave) {
    const parts = [
      conversation.saveState === 'ask' && 'this conversation',
      workspace.save === 'ask' && 'your workspace draft',
    ].filter(Boolean)
    notices.push(
      <Notice key="ask" title={`Save ${parts.join(' and ')} to your account?`}>
        <p>
          You started it before signing in.
          {workspace.save === 'ask' && ' Saving the draft replaces any draft already in your account.'}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => {
              conversation.saveToAccount()
              workspace.saveToAccount()
            }}
          >
            Save to my account
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-small"
            onClick={() => {
              if (conversation.saveState === 'ask') conversation.keepLocal()
              if (workspace.save === 'ask') workspace.keepLocal()
            }}
          >
            Keep it in this tab only
          </button>
        </div>
      </Notice>,
    )
  }
  if (conversation.hasLegacy && !askingToSave) {
    notices.push(
      <Notice key="legacy" title="A conversation from an earlier visit is still in this browser.">
        <p>
          {signedIn
            ? 'You can save it to your account, or delete it from this browser.'
            : 'Hetu no longer keeps guest conversations. You can open this one here, or delete it.'}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary btn-small" onClick={conversation.openLegacy}>
            {signedIn ? 'Save it to my account' : 'Open it'}
          </button>
          <button type="button" className="btn btn-quiet btn-small" onClick={conversation.discardLegacy}>
            Delete it
          </button>
        </div>
      </Notice>,
    )
  }
  if (conversation.saveState === 'error') {
    notices.push(
      <Notice key="save-error" title="This conversation is not saved.">
        <p>Saving is unavailable right now. Everything stays in this tab, and you can keep going.</p>
        <button type="button" className="btn btn-secondary btn-small mt-2" onClick={conversation.retrySave}>
          Try saving again
        </button>
      </Notice>,
    )
  }
  if (account.status === 'unavailable') {
    notices.push(
      <Notice key="accounts" title="Accounts are unavailable right now.">
        <p>You can keep learning as a guest. Signing in may work again in a little while.</p>
      </Notice>,
    )
  }

  const saveNote =
    account.status === 'disabled'
      ? 'Not saved. A conversation ends when you leave.'
      : conversation.saveState === 'off'
        ? 'Not saved. Sign in to keep your conversations.'
        : CONVERSATION_SAVE[conversation.saveState]

  return (
    <div className="flex h-dvh flex-col">
      <a
        href="#main"
        className="sr-only rounded-md bg-surface px-4 py-2 font-medium text-accent focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-10"
      >
        Skip to main content
      </a>
      <header className="border-b border-rule">
        <div className="flex items-center gap-2 px-5 py-3 sm:gap-3 sm:px-8">
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Hetu</h1>
          <span className="hidden text-sm text-muted md:inline">A companion for learning to reason</span>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {signedIn && !sideBySide && (
              <button
                type="button"
                aria-expanded={historyOpen}
                aria-controls="history"
                className="btn btn-quiet btn-small"
                onClick={() => {
                  setHistoryOpen(!historyOpen)
                  workspace.setPanel(null)
                }}
              >
                History
              </button>
            )}
            {conversation.turns.length > 0 && (
              <button
                type="button"
                className="btn btn-quiet btn-small"
                onClick={() => {
                  conversation.newSession()
                  showConversation()
                }}
              >
                New
              </button>
            )}
            <button
              type="button"
              aria-expanded={panelOpen}
              aria-controls="workspace"
              onClick={() => {
                setHistoryOpen(false)
                workspace.setPanel(panelOpen ? null : workspace.inspection ? 'structure' : 'draft')
              }}
              className="btn btn-secondary btn-small"
            >
              Workspace
            </button>
            {signedIn ? (
              <button type="button" className="btn btn-quiet btn-small max-w-40" onClick={() => setAccountOpen(true)}>
                <span className="sr-only">Account:</span>{' '}
                <span className="truncate">{name}</span>
              </button>
            ) : (
              account.status !== 'disabled' && (
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={account.status === 'loading' || account.status === 'unavailable'}
                  onClick={() => setAuthOpen(true)}
                >
                  Sign in
                </button>
              )
            )}
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex min-h-0 flex-1">
        {showHistory && (
          <div id="history" className="flex min-h-0 w-full flex-col border-rule lg:w-64 lg:shrink-0 lg:border-r">
            <HistoryPanel
              history={history}
              currentId={conversation.conversationId}
              onOpen={(id) => {
                void conversation.open(id)
                showConversation()
              }}
              onNew={() => {
                conversation.newSession()
                showConversation()
              }}
              onDeletedCurrent={conversation.newSession}
            />
          </div>
        )}

        <div className={'min-h-0 min-w-0 flex-1 flex-col ' + (conversationHidden ? 'hidden' : 'flex')}>
          <Conversation
            conversation={conversation}
            workspace={draft}
            notices={notices}
            saveNote={saveNote}
            onOpenInspection={workspace.openInspection}
            onOpenWorkspace={() => workspace.setPanel('draft')}
          />
        </div>

        {workspace.panel !== null && (
          <WorkspacePanel
            view={workspace.panel}
            onViewChange={workspace.setPanel}
            onClose={() => workspace.setPanel(null)}
            hasStructure={workspace.inspection !== null}
            sideBySide={sideBySide}
          >
            {workspace.panel === 'draft' ? (
              <FreeformEditor
                problem={workspace.problem}
                draft={workspace.draft}
                busy={workspace.busy !== null}
                error={workspace.error}
                notice={workspace.notice}
                focusRequest={workspace.focusRequest}
                saveLabel={WORKSPACE_SAVE[workspace.save]}
                onProblemChange={workspace.setProblem}
                onDraftChange={workspace.setDraft}
                onLoadExample={workspace.loadExample}
                onInspect={workspace.inspect}
                onDiscuss={getFeedback}
                onAskAbout={askAbout}
                onReset={workspace.reset}
              />
            ) : (
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
                onDiscuss={(node) => askAbout(node.text)}
                onChallenge={workspace.challenge}
              />
            )}
          </WorkspacePanel>
        )}
      </main>

      {account.status !== 'disabled' && (
        <AuthDialog open={authOpen} account={account} onClose={() => setAuthOpen(false)} />
      )}
      {signedIn && accountStore && (
        <AccountDialog
          open={accountOpen}
          account={account}
          store={accountStore}
          displayName={displayName}
          onDisplayNameChange={setDisplayName}
          onClose={() => setAccountOpen(false)}
          onDataDeleted={() => {
            conversation.newSession()
            workspace.reset()
            setDisplayName(null)
            void history.reload()
          }}
        />
      )}
    </div>
  )
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-rule bg-surface px-4 py-3 text-sm">
      <p className="font-medium">{title}</p>
      <div className="mt-1 text-muted">{children}</div>
    </section>
  )
}
