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
import { useTheme } from './lib/useTheme'
import { Logo } from './components/Logo'
import { ThemeToggle } from './components/ThemeToggle'

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

// One quiet word in the header. The title explains it on hover.
const SAVE_WORD: Record<SaveState, [string, string] | null> = {
  off: ['Not saved', 'Guest conversations end when you leave. Sign in to keep them.'],
  local: ['Not saved', 'You chose to keep this conversation in this tab only.'],
  ask: ['Not saved', 'Choose below whether to save this conversation to your account.'],
  saving: ['Saving…', 'Saving to your account.'],
  saved: ['Saved', 'Saved to your account.'],
  error: ['Not saved', 'Saving is unavailable right now. Your work stays in this tab.'],
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
  const theme = useTheme()
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
    // Focus without scrolling anything else, then bring the panel to its top.
    const heading = resultHeading.current
    if (workspace.resultVersion === 0 || !heading) return
    heading.focus({ preventScroll: true })
    heading.closest('[data-scroll]')?.scrollTo?.({ top: 0 })
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

  const saveWord = conversation.turns.length > 0 ? SAVE_WORD[conversation.saveState] : null

  // Under the starting points: a way back into recent work, or how saving works.
  const recent = history.items.slice(0, 3)
  // On wide screens the sidebar already lists them, so they are not repeated.
  const welcomeExtras = signedIn ? (
    recent.length > 0 &&
    !sideBySide && (
      <section aria-labelledby="recent-heading" className="mt-8">
        <h3 id="recent-heading" className="eyebrow">
          Continue where you left off
        </h3>
        <ul role="list" className="mt-2 divide-y divide-rule rounded-lg border border-rule bg-surface">
          {recent.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void conversation.open(item.id)}
                className="flex w-full items-baseline justify-between gap-4 px-4 py-3 text-left hover:bg-accent-soft"
              >
                <span className="truncate">{item.title}</span>
                <span className="shrink-0 text-xs text-muted">{recentDate.format(new Date(item.updated_at))}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    )
  ) : account.status === 'guest' ? (
    <p className="mt-6 text-sm text-muted">
      As a guest, nothing is saved.{' '}
      <button
        type="button"
        className="font-medium text-accent underline underline-offset-4"
        onClick={() => setAuthOpen(true)}
      >
        Sign in
      </button>{' '}
      to keep your conversations and come back to them.
    </p>
  ) : null

  return (
    <div className="flex h-dvh flex-col overflow-clip">
      <a
        href="#main"
        className="sr-only rounded-md bg-surface px-4 py-2 font-medium text-accent focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-10"
      >
        Skip to main content
      </a>
      <header className="border-b border-rule">
        <div className="flex h-14 items-center gap-2 px-4 sm:gap-3 sm:px-6">
          <h1 className="shrink-0">
            <Logo className="h-6 w-auto sm:h-7" />
          </h1>
          {saveWord && (
            <span role="status" title={saveWord[1]} className="hidden truncate text-xs text-muted sm:inline">
              {saveWord[0]}
            </span>
          )}
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
            <ThemeToggle choice={theme.choice} onCycle={theme.cycle} />
            {signedIn ? (
              <button type="button" className="btn btn-quiet btn-small max-w-40" onClick={() => setAccountOpen(true)}>
                <span className="sr-only">Account:</span> <span className="truncate">{name}</span>
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

      <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 overflow-clip">
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
            welcomeExtras={welcomeExtras}
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

const recentDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-rule bg-surface px-4 py-3 text-sm">
      <p className="font-medium">{title}</p>
      <div className="mt-1 text-muted">{children}</div>
    </section>
  )
}
