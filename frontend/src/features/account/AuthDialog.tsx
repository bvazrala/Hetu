import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useModal } from '../../lib/useModal'
import type { Account, ActionResult } from './useAccount'

type Step = 'sign-in' | 'sign-up' | 'verify' | 'forgot' | 'reset'

interface Props {
  open: boolean
  account: Account
  onClose: () => void
  initialStep?: 'sign-in' | 'sign-up'
}

const TITLES: Record<Step, string> = {
  'sign-in': 'Sign in to Hetu',
  'sign-up': 'Create an account',
  verify: 'Confirm your email',
  forgot: 'Reset your password',
  reset: 'Choose a new password',
}

const MIN_PASSWORD = 8

/**
 * Sign in, sign up, email confirmation, and password reset in one dialog.
 * Codes are used rather than links because Neon's shared email sender
 * supports only codes.
 */
export function AuthDialog({ open, account, onClose, initialStep = 'sign-in' }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [step, setStep] = useState<Step>(initialStep)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null)

  useModal(dialog, open, () => {
    setStep(initialStep)
    setMessage(null)
    setCode('')
    setPassword('')
  })

  function go(next: Step, note?: string) {
    setStep(next)
    setCode('')
    setMessage(note ? { text: note, tone: 'info' } : null)
  }

  async function act(work: () => Promise<ActionResult>, onSuccess: () => void | Promise<void>) {
    setBusy(true)
    setMessage(null)
    const result = await work()
    setBusy(false)
    if (result.ok) await onSuccess()
    else if (result.needsVerification) {
      await account.sendVerificationCode(email)
      go('verify', result.message)
    } else setMessage({ text: result.message ?? 'Something went wrong.', tone: 'error' })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (step === 'sign-in') void act(() => account.signIn(email, password), onClose)
    if (step === 'sign-up') {
      void act(
        () => account.signUp(email, password, name.trim()),
        async () => {
          // With email confirmation on, sign-up does not sign in. The code comes next.
          if ((await account.refresh()) === 'signed-in') onClose()
          else go('verify', `We sent a code to ${email}. It may take a minute to arrive.`)
        },
      )
    }
    if (step === 'verify') {
      void act(
        () => account.verifyEmail(email, code.trim()),
        async () => {
          // Neon Auth can sign the student in on confirmation. If not, they sign in next.
          if ((await account.refresh()) === 'signed-in') onClose()
          else go('sign-in', 'Your email is confirmed. Sign in to continue.')
        },
      )
    }
    if (step === 'forgot') {
      void act(
        () => account.sendResetCode(email),
        () => go('reset', `If ${email} has an account, a code is on its way.`),
      )
    }
    if (step === 'reset') {
      void act(
        () => account.resetPassword(email, code.trim(), password),
        () => act(() => account.signIn(email, password), onClose),
      )
    }
  }

  const needsPassword = step === 'sign-in' || step === 'sign-up' || step === 'reset'
  const needsCode = step === 'verify' || step === 'reset'

  return (
    <dialog
      ref={dialog}
      aria-labelledby="auth-title"
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-rule bg-paper p-0 text-ink shadow-xl backdrop:bg-backdrop"
    >
      <div className="px-6 pt-5 pb-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id="auth-title" className="font-serif text-2xl font-semibold">
            {TITLES[step]}
          </h2>
          <button type="button" className="btn btn-quiet btn-small -mr-2" onClick={onClose}>
            Close
          </button>
        </div>

        {(step === 'sign-in' || step === 'sign-up') && (
          <>
            <p className="mt-1 text-sm text-muted">
              An account keeps your conversations and workspace so you can come back to them.
            </p>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => account.signInWith('google'),
                    () => {},
                  )
                }
              >
                Continue with Google
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => account.signInWith('github'),
                    () => {},
                  )
                }
              >
                Continue with GitHub
              </button>
            </div>
            <p className="my-4 flex items-center gap-3 text-xs text-muted before:h-px before:flex-1 before:bg-rule after:h-px after:flex-1 after:bg-rule">
              or with email
            </p>
          </>
        )}

        <form className="mt-2 space-y-3" onSubmit={submit} noValidate={false}>
          {step === 'sign-up' && (
            <Field label="Name (optional)" htmlFor="auth-name">
              <input
                id="auth-name"
                autoComplete="name"
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field py-2 font-sans text-base"
              />
            </Field>
          )}
          {step !== 'reset' && step !== 'verify' && (
            <Field label="Email" htmlFor="auth-email">
              <input
                id="auth-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field py-2 font-sans text-base"
              />
            </Field>
          )}
          {needsCode && (
            <Field label="Code from the email" htmlFor="auth-code">
              <input
                id="auth-code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={12}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="field py-2 font-sans text-base tracking-widest"
              />
            </Field>
          )}
          {needsPassword && (
            <Field label={step === 'reset' ? 'New password' : 'Password'} htmlFor="auth-password">
              <input
                id="auth-password"
                type="password"
                required
                minLength={step === 'sign-in' ? undefined : MIN_PASSWORD}
                autoComplete={step === 'sign-in' ? 'current-password' : 'new-password'}
                aria-describedby={step === 'sign-in' ? undefined : 'password-rule'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field py-2 font-sans text-base"
              />
              {step !== 'sign-in' && (
                <p id="password-rule" className="mt-1 text-xs text-muted">
                  At least {MIN_PASSWORD} characters.
                </p>
              )}
            </Field>
          )}

          <p aria-live="polite" className="min-h-5 text-sm">
            {message && (
              <span className={message.tone === 'error' ? 'border-l-2 border-flag pl-2' : 'text-muted'}>
                {message.text}
              </span>
            )}
          </p>

          <button type="submit" disabled={busy} className="btn btn-primary w-full">
            {busy
              ? 'One moment…'
              : {
                  'sign-in': 'Sign in',
                  'sign-up': 'Create account',
                  verify: 'Confirm email',
                  forgot: 'Send a reset code',
                  reset: 'Set password and sign in',
                }[step]}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
          {step === 'sign-in' && (
            <>
              <button type="button" className="text-accent underline underline-offset-4" onClick={() => go('sign-up')}>
                Create an account
              </button>
              <button type="button" className="text-muted underline underline-offset-4" onClick={() => go('forgot')}>
                Forgot your password?
              </button>
            </>
          )}
          {step === 'sign-up' && (
            <button type="button" className="text-accent underline underline-offset-4" onClick={() => go('sign-in')}>
              I already have an account
            </button>
          )}
          {step === 'verify' && (
            <button
              type="button"
              className="text-muted underline underline-offset-4"
              disabled={busy}
              onClick={() =>
                void act(
                  () => account.sendVerificationCode(email),
                  () => go('verify', 'A new code is on its way.'),
                )
              }
            >
              Send a new code
            </button>
          )}
          {(step === 'forgot' || step === 'reset' || step === 'verify') && (
            <button type="button" className="text-accent underline underline-offset-4" onClick={() => go('sign-in')}>
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </dialog>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  )
}
