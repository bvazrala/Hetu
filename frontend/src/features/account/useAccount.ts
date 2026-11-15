import { useCallback, useEffect, useState } from 'react'
import { auth as defaultAuth, type AuthApi, type AuthUser } from '../../lib/neon'

export type AccountStatus =
  /** Accounts are not configured on this site. Everyone is a guest. */
  | 'disabled'
  | 'loading'
  | 'guest'
  | 'signed-in'
  /** Accounts are configured but could not be reached. Guests can still learn. */
  | 'unavailable'

/** The outcome of an account action, worded for the student. */
export interface ActionResult {
  ok: boolean
  message?: string
  /** Sign-in was refused because the email address has not been confirmed yet. */
  needsVerification?: boolean
}

const UNREACHABLE = 'Accounts are unavailable right now. You can keep learning as a guest.'

function failure(error: { message?: string; code?: string; status?: number } | null | undefined): ActionResult {
  if (error?.code === 'EMAIL_NOT_VERIFIED') {
    return { ok: false, needsVerification: true, message: 'Confirm your email address first. We sent you a code.' }
  }
  if (error?.code === 'INVALID_EMAIL_OR_PASSWORD') return { ok: false, message: 'That email and password do not match.' }
  if (error?.code === 'USER_ALREADY_EXISTS' || error?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
    return { ok: false, message: 'An account with that email already exists. Sign in instead.' }
  }
  if (error?.code === 'PASSWORD_TOO_SHORT') return { ok: false, message: 'Use at least 8 characters.' }
  if (error?.code === 'INVALID_OTP' || error?.code === 'OTP_EXPIRED') {
    return { ok: false, message: 'That code is not valid. Check it, or ask for a new one.' }
  }
  if (error?.status === 429) return { ok: false, message: 'Too many attempts. Wait a minute and try again.' }
  // The service's own message is shown when it gave one. It never contains secrets.
  return { ok: false, message: error?.message || UNREACHABLE }
}

async function run(work: () => Promise<{ error: unknown }>): Promise<ActionResult> {
  try {
    const { error } = await work()
    return error ? failure(error as Parameters<typeof failure>[0]) : { ok: true }
  } catch {
    return { ok: false, message: UNREACHABLE }
  }
}

async function readSession(api: AuthApi): Promise<{ user: AuthUser | null; status: AccountStatus }> {
  try {
    const { data, error } = await api.getSession()
    if (error) throw new Error(error.message)
    return { user: data?.user ?? null, status: data?.user ? 'signed-in' : 'guest' }
  } catch {
    return { user: null, status: 'unavailable' }
  }
}

/**
 * The student's account, if they have one. Sessions live in Neon Auth's
 * cookie, so a returning student is signed in again on load, including after
 * an OAuth redirect.
 */
export function useAccount(api: AuthApi | null = defaultAuth) {
  const [status, setStatus] = useState<AccountStatus>(api ? 'loading' : 'disabled')
  const [user, setUser] = useState<AuthUser | null>(null)

  /** Reads the session again. Returns the new status, since state updates arrive later. */
  const refresh = useCallback(async (): Promise<AccountStatus> => {
    if (!api) return 'disabled'
    const { user: next, status: nextStatus } = await readSession(api)
    setUser(next)
    setStatus(nextStatus)
    return nextStatus
  }, [api])

  // A returning student, including one coming back from Google or GitHub, is signed in again here.
  useEffect(() => {
    if (!api) return
    let cancelled = false
    readSession(api).then(({ user: next, status: nextStatus }) => {
      if (cancelled) return
      setUser(next)
      setStatus(nextStatus)
    })
    return () => {
      cancelled = true
    }
  }, [api])

  async function afterSignIn(result: ActionResult): Promise<ActionResult> {
    if (result.ok) await refresh()
    return result
  }

  return {
    status,
    user,
    refresh,

    signIn: async (email: string, password: string) =>
      afterSignIn(await run(() => api!.signIn.email({ email, password }))),

    signUp: (email: string, password: string, name: string) =>
      run(() => api!.signUp.email({ email, password, name: name || email.split('@')[0] })),

    /** Starts Google or GitHub sign-in. The page leaves for the provider and comes back here. */
    signInWith: (provider: 'google' | 'github') =>
      run(() => api!.signIn.social({ provider, callbackURL: window.location.origin + window.location.pathname })),

    sendVerificationCode: (email: string) =>
      run(() => api!.emailOtp.sendVerificationOtp({ email, type: 'email-verification' })),

    verifyEmail: async (email: string, code: string) =>
      afterSignIn(await run(() => api!.emailOtp.verifyEmail({ email, otp: code }))),

    sendResetCode: (email: string) => run(() => api!.forgetPassword.emailOtp({ email })),

    resetPassword: (email: string, code: string, password: string) =>
      run(() => api!.emailOtp.resetPassword({ email, otp: code, password })),

    signOut: async () => {
      const result = await run(() => api!.signOut())
      setUser(null)
      setStatus('guest')
      return result
    },

    /** Deletes the sign-in account itself. Neon Auth may not allow this; the result says so. */
    deleteAccount: async () => {
      const result = await run(() => api!.deleteUser({}))
      if (result.ok) {
        setUser(null)
        setStatus('guest')
      }
      return result
    },
  }
}

export type Account = ReturnType<typeof useAccount>
