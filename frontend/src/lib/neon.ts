import { createClient } from '@neon/neon-js'
import { BetterAuthVanillaAdapter } from '@neon/neon-js/auth/vanilla/adapters'

// Both are public addresses, not secrets. The Data API only answers a
// request with a valid sign-in token, and only with that user's own rows.
const AUTH_URL = import.meta.env.VITE_NEON_AUTH_URL as string | undefined
const DATA_API_URL = import.meta.env.VITE_NEON_DATA_API_URL as string | undefined

export interface AuthUser {
  id: string
  email: string
  name: string
  emailVerified: boolean
}

interface AuthFailure {
  message?: string
  code?: string
  status?: number
}

type Result<T = unknown> = Promise<{ data: T | null; error: AuthFailure | null }>

/**
 * The Neon Auth calls that Hetu makes. The SDK's own type for its client
 * leaves out the email code methods that its runtime includes, so they are
 * described here. Each name maps to a Better Auth endpoint, for example
 * `emailOtp.verifyEmail` to `/email-otp/verify-email`.
 */
export interface AuthApi {
  getSession(): Result<{ user: AuthUser; session: { token: string } }>
  signIn: {
    email(credentials: { email: string; password: string }): Result
    social(options: { provider: 'google' | 'github'; callbackURL: string }): Result
  }
  signUp: { email(details: { email: string; password: string; name: string }): Result }
  signOut(): Result
  emailOtp: {
    sendVerificationOtp(options: { email: string; type: 'email-verification' }): Result
    verifyEmail(options: { email: string; otp: string }): Result
    resetPassword(options: { email: string; otp: string; password: string }): Result
  }
  forgetPassword: { emailOtp(options: { email: string }): Result }
  deleteUser(options?: Record<string, never>): Result
}

const client =
  AUTH_URL && DATA_API_URL
    ? createClient({
        auth: { url: AUTH_URL, adapter: BetterAuthVanillaAdapter() },
        dataApi: { url: DATA_API_URL },
      })
    : null

/** The Data API client, or null when accounts are not configured. Requests carry the user's token. */
export const database = client

/** Neon Auth, or null when accounts are not configured. Hetu then runs for guests only. */
export const auth = client ? (client.auth as unknown as AuthApi) : null

/** The signed-in user's current token, for calls to Hetu's own API. Null for guests. */
export async function accessToken(): Promise<string | null> {
  if (!auth) return null
  try {
    const { data } = await auth.getSession()
    return data?.session.token ?? null
  } catch {
    return null
  }
}
