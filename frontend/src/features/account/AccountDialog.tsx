import { useRef, useState } from 'react'
import { useModal } from '../../lib/useModal'
import type { Store } from '../../lib/store'
import type { Account } from './useAccount'

interface Props {
  open: boolean
  account: Account
  store: Store
  displayName: string | null
  onDisplayNameChange: (name: string | null) => void
  onClose: () => void
  /** Called after the student's data is deleted, so the screen can start fresh. */
  onDataDeleted: () => void
}

/** The signed-in student's profile, sign-out, and deletion of their data. */
export function AccountDialog({ open, account, store, displayName, onDisplayNameChange, onClose, onDataDeleted }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(displayName ?? '')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useModal(dialog, open, () => {
    setName(displayName ?? '')
    setConfirming(false)
    setMessage(null)
  })

  async function saveName() {
    setBusy(true)
    const next = name.trim() || null
    try {
      await store.saveDisplayName(next)
      onDisplayNameChange(next)
      setMessage('Saved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Your name could not be saved.')
    }
    setBusy(false)
  }

  async function deleteEverything() {
    setBusy(true)
    try {
      await store.deleteAllData()
    } catch {
      setBusy(false)
      setMessage('Your data could not be deleted right now. Nothing was removed. Try again later.')
      return
    }
    onDataDeleted()
    // The data is gone. Removing the sign-in itself depends on what Neon Auth allows.
    const result = await account.deleteAccount()
    setBusy(false)
    setConfirming(false)
    setMessage(
      result.ok
        ? 'Your conversations, workspace, profile, and account were deleted.'
        : 'Your conversations, workspace, and profile were deleted. Your sign-in could not be removed from here, so it still exists. It holds your email address and name only.',
    )
  }

  const user = account.user

  return (
    <dialog
      ref={dialog}
      aria-labelledby="account-title"
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-rule bg-paper p-0 text-ink shadow-xl backdrop:bg-ink/30"
    >
      <div className="space-y-5 px-6 pt-5 pb-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id="account-title" className="font-serif text-2xl font-semibold">
            Your account
          </h2>
          <button type="button" className="btn btn-quiet btn-small -mr-2" onClick={onClose}>
            Close
          </button>
        </div>

        {user && <p className="text-sm text-muted">Signed in as {user.email}</p>}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void saveName()
          }}
        >
          <label htmlFor="display-name" className="mb-1 block text-sm font-medium">
            Display name
          </label>
          <div className="flex gap-2">
            <input
              id="display-name"
              maxLength={80}
              value={name}
              placeholder={user?.name ?? ''}
              onChange={(event) => setName(event.target.value)}
              className="field py-2 font-sans text-base"
            />
            <button type="submit" className="btn btn-secondary" disabled={busy}>
              Save
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">Shown in Hetu only. Leave it empty to use the name from sign-in.</p>
        </form>

        <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={async () => {
              await account.signOut()
              onClose()
            }}
          >
            Sign out
          </button>
          {!confirming && (
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setConfirming(true)}>
              Delete my data…
            </button>
          )}
        </div>

        {confirming && (
          <div className="rounded-md border border-flag/40 bg-flag-soft px-4 py-3 text-sm">
            <p className="font-medium">Delete all your conversations, notes, workspace, and profile?</p>
            <p className="mt-1 text-muted">This cannot be undone. Hetu will then try to remove your sign-in as well.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={deleteEverything}>
                {busy ? 'Deleting…' : 'Delete everything'}
              </button>
              <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <p aria-live="polite" className="min-h-5 text-sm">
          {message}
        </p>
      </div>
    </dialog>
  )
}
