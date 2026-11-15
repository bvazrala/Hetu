import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '../../lib/neon'
import type { ConversationSummary, Store, StoredMessage, StoredWorkspace } from '../../lib/store'
import type { ChatResponse, LearningState } from '../../lib/types'

// A stand-in for Neon Auth that keeps one session, as its cookie would.
const authState = vi.hoisted(() => ({
  user: null as AuthUser | null,
  verified: true,
  failNextSignIn: null as null | { code: string; message: string },
  calls: [] as string[],
  socialOptions: null as unknown,
  deleteUserFails: true,
}))

function ok<T>(data: T) {
  return Promise.resolve({ data, error: null })
}

vi.mock('../../lib/neon', () => {
  const user = (email: string): AuthUser => ({ id: `id-${email}`, email, name: email.split('@')[0], emailVerified: true })
  const auth = {
    getSession: () => ok(authState.user ? { user: authState.user, session: { token: 'jwt' } } : null),
    signIn: {
      email: ({ email }: { email: string }) => {
        authState.calls.push(`signIn:${email}`)
        if (authState.failNextSignIn) {
          const error = authState.failNextSignIn
          authState.failNextSignIn = null
          return Promise.resolve({ data: null, error })
        }
        authState.user = user(email)
        return ok({})
      },
      social: (options: unknown) => {
        authState.socialOptions = options
        return ok({})
      },
    },
    signUp: {
      email: ({ email }: { email: string }) => {
        authState.calls.push(`signUp:${email}`)
        if (authState.verified) authState.user = user(email)
        return ok({})
      },
    },
    signOut: () => {
      authState.user = null
      return ok({})
    },
    emailOtp: {
      sendVerificationOtp: ({ email }: { email: string }) => {
        authState.calls.push(`sendCode:${email}`)
        return ok({})
      },
      verifyEmail: ({ email, otp }: { email: string; otp: string }) => {
        authState.calls.push(`verify:${email}:${otp}`)
        if (otp !== '123456') return Promise.resolve({ data: null, error: { code: 'INVALID_OTP' } })
        authState.user = user(email)
        return ok({})
      },
      resetPassword: ({ email, otp }: { email: string; otp: string }) => {
        authState.calls.push(`reset:${email}:${otp}`)
        return ok({})
      },
    },
    forgetPassword: {
      emailOtp: ({ email }: { email: string }) => {
        authState.calls.push(`forgot:${email}`)
        return ok({})
      },
    },
    deleteUser: () =>
      authState.deleteUserFails
        ? Promise.resolve({ data: null, error: { message: 'Not allowed' } })
        : ((authState.user = null), ok({})),
  }
  return { auth, database: null, accessToken: async () => (authState.user ? 'jwt' : null) }
})

// An in-memory stand-in for the Data API, with one space per user.
const db = vi.hoisted(() => ({
  conversations: new Map<string, { owner: string; title: string; intent: string | null; messages: StoredMessage[]; notes: LearningState | null; updated: number }>(),
  workspaces: new Map<string, StoredWorkspace>(),
  names: new Map<string, string | null>(),
  failing: false,
  clock: 0,
}))

vi.mock('../../lib/store', async (original) => {
  const actual = await original<typeof import('../../lib/store')>()
  const owner = () => authState.user!.id
  const guard = () => {
    if (db.failing) throw new actual.StoreError(actual.UNAVAILABLE)
  }
  const fake: Store = {
    async listConversations() {
      guard()
      return [...db.conversations.entries()]
        .filter(([, c]) => c.owner === owner())
        .sort((a, b) => b[1].updated - a[1].updated)
        .map(([id, c]): ConversationSummary => ({ id, title: c.title, updated_at: new Date(2026, 10, 15).toISOString() }))
    },
    async createConversation(title, intent) {
      guard()
      const id = `c${db.conversations.size + 1}`
      db.conversations.set(id, { owner: owner(), title, intent, messages: [], notes: null, updated: ++db.clock })
      return id
    },
    async renameConversation(id, title) {
      guard()
      db.conversations.get(id)!.title = title
    },
    async deleteConversation(id) {
      guard()
      db.conversations.delete(id)
    },
    async loadConversation(id) {
      guard()
      const c = db.conversations.get(id)!
      return { intent: c.intent as never, messages: c.messages, notes: c.notes }
    },
    async appendMessage(id, message) {
      guard()
      const c = db.conversations.get(id)!
      c.messages.push(message)
      c.updated = ++db.clock
    },
    async saveNotes(id, notes) {
      guard()
      db.conversations.get(id)!.notes = notes
    },
    async loadWorkspace() {
      guard()
      return db.workspaces.get(owner()) ?? null
    },
    async saveWorkspace(workspace) {
      guard()
      db.workspaces.set(owner(), workspace)
    },
    async loadDisplayName() {
      return db.names.get(owner()) ?? null
    },
    async saveDisplayName(name) {
      db.names.set(owner(), name)
    },
    async deleteAllData() {
      guard()
      for (const [id, c] of db.conversations) if (c.owner === owner()) db.conversations.delete(id)
      db.workspaces.delete(owner())
      db.names.delete(owner())
    },
  }
  return { ...actual, store: fake }
})

vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  sendChat: vi.fn(),
  checkHealth: vi.fn().mockResolvedValue(true),
}))

const { sendChat } = await import('../../lib/api')
const { default: App } = await import('../../App')
const chat = vi.mocked(sendChat)

const NOTES: LearningState = {
  topic: 'classes',
  goal: null,
  concepts: ['classes'],
  understood: [],
  misconceptions: [],
  open_questions: [],
  dismissed: [],
}

function reply(text: string, extra: Partial<ChatResponse> = {}): ChatResponse {
  return { reply: text, action: 'explain', specialists: [], learning_state: NOTES, inspection: null, checks: [], ...extra }
}

const field = () => screen.getByLabelText<HTMLTextAreaElement>('Message Hetu')

async function say(text: string) {
  await userEvent.type(field(), text)
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
}

async function signIn(email = 'ada@example.com') {
  await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
  const dialog = screen.getByRole('dialog', { name: 'Sign in to Hetu' })
  await userEvent.clear(within(dialog).getByLabelText('Email'))
  await userEvent.type(within(dialog).getByLabelText('Email'), email)
  await userEvent.type(within(dialog).getByLabelText('Password'), 'correct horse')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('button', { name: `Account: ${email.split('@')[0]}` })
}

/** On a narrow screen, as in these tests, the history opens in place of the conversation. */
async function openHistory() {
  await userEvent.click(screen.getByRole('button', { name: 'History' }))
  return screen.findByRole('navigation', { name: 'Your conversations' })
}

async function signOut() {
  await userEvent.click(screen.getByRole('button', { name: /^Account:/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  await screen.findByRole('button', { name: 'Sign in' })
}

beforeEach(() => {
  chat.mockReset()
  authState.user = null
  authState.verified = true
  authState.failNextSignIn = null
  authState.calls = []
  authState.deleteUserFails = true
  db.conversations.clear()
  db.workspaces.clear()
  db.names.clear()
  db.failing = false
})

describe('a signed-in student', () => {
  it('saves a conversation, signs out, signs back in, and finds it again', async () => {
    chat.mockResolvedValue(reply('A class is a blueprint.'))
    render(<App />)
    await signIn()

    await say("I don't understand classes.")
    await screen.findByText('A class is a blueprint.')
    await vi.waitFor(() => expect([...db.conversations.values()][0]?.messages).toHaveLength(2))
    const saved = [...db.conversations.values()][0]
    expect(saved.title).toBe("I don't understand classes.")
    expect(saved.messages.map((m) => m.role)).toEqual(['student', 'hetu'])
    expect(saved.messages[1].meta).toMatchObject({ action: 'explain' })
    await vi.waitFor(() => expect(saved.notes?.topic).toBe('classes'))
    expect(screen.getByText('Saved to your account.')).toBeInTheDocument()

    await signOut()
    // Nothing from the account stays on screen after sign-out.
    expect(screen.queryByText('A class is a blueprint.')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Your conversations' })).toBeNull()

    await signIn()
    const history = await openHistory()
    await userEvent.click(await within(history).findByRole('button', { name: /^I don't understand classes/ }))

    expect(await screen.findByText('A class is a blueprint.')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Session notes'))
    expect(screen.getAllByText('classes').length).toBeGreaterThan(0)

    // The conversation continues where it left off, with its earlier turns sent to Hetu.
    chat.mockResolvedValue(reply('A subclass extends a class.'))
    await say('And inheritance?')
    await screen.findByText('A subclass extends a class.')
    expect(chat.mock.lastCall![0].messages).toHaveLength(3)
    await vi.waitFor(() => expect(saved.messages).toHaveLength(4))
    expect(db.conversations.size).toBe(1)
  })

  it("does not see another student's conversations", async () => {
    chat.mockResolvedValue(reply('Light scatters.'))
    render(<App />)
    await signIn('ada@example.com')
    await say('Why is the sky blue?')
    await vi.waitFor(() => expect([...db.conversations.values()][0]?.messages).toHaveLength(2))
    await signOut()

    await signIn('grace@example.com')
    const history = await openHistory()
    expect(await within(history).findByText(/saved here/)).toBeInTheDocument()
    expect(within(history).queryByText(/sky/)).toBeNull()
  })

  it('renames and deletes a conversation', async () => {
    chat.mockResolvedValue(reply('Okay.'))
    render(<App />)
    await signIn()
    await say('First question.')
    await vi.waitFor(() => expect(db.conversations.size).toBe(1))

    const history = await openHistory()
    await userEvent.click(await within(history).findByRole('button', { name: 'Rename First question.' }))
    const input = within(history).getByLabelText('New name for First question.')
    await userEvent.clear(input)
    await userEvent.type(input, 'Warm up{Enter}')
    await vi.waitFor(() => expect([...db.conversations.values()][0].title).toBe('Warm up'))

    await userEvent.click(within(history).getByRole('button', { name: 'Delete Warm up' }))
    await userEvent.click(within(history).getByRole('button', { name: 'Delete' }))
    await vi.waitFor(() => expect(db.conversations.size).toBe(0))
    // The open conversation was the one deleted, so the screen starts fresh.
    await userEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(await screen.findByRole('heading', { name: 'What are you working on?' })).toBeInTheDocument()
  })

  it('keeps working and says so when saving fails, then saves on retry', async () => {
    chat.mockResolvedValue(reply('Light scatters.'))
    render(<App />)
    await signIn()
    db.failing = true
    await say('Why is the sky blue?')

    expect(await screen.findByText('Light scatters.')).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'This conversation is not saved.' })).toBeInTheDocument()

    db.failing = false
    await userEvent.click(screen.getByRole('button', { name: 'Try saving again' }))
    await vi.waitFor(() => expect([...db.conversations.values()][0]?.messages).toHaveLength(2))
    expect(screen.queryByRole('region', { name: 'This conversation is not saved.' })).toBeNull()
  })

  it('saves the workspace draft to the account and gets it back after signing in again', async () => {
    render(<App />)
    await signIn()
    await userEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    await userEvent.type(screen.getByLabelText('Your work'), 'Assume n is odd.')
    await vi.waitFor(() => expect(db.workspaces.get('id-ada@example.com')?.draft).toBe('Assume n is odd.'), { timeout: 3000 })
    expect(screen.getByText('Saved to your account')).toBeInTheDocument()

    await signOut()
    // The panel is still open, and the account's draft is gone from it.
    expect(screen.getByLabelText<HTMLTextAreaElement>('Your work').value).toBe('')

    await signIn()
    await vi.waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>('Your work').value).toBe('Assume n is odd.'))
  })

  it('can change their display name and delete their data', async () => {
    chat.mockResolvedValue(reply('Okay.'))
    render(<App />)
    await signIn()
    await say('A question.')
    await vi.waitFor(() => expect(db.conversations.size).toBe(1))

    await userEvent.click(screen.getByRole('button', { name: /^Account:/ }))
    const dialog = screen.getByRole('dialog', { name: 'Your account' })
    await userEvent.type(within(dialog).getByLabelText('Display name'), 'Ada L.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('button', { name: 'Account: Ada L.' })).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete my data…' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete everything' }))
    expect(await within(dialog).findByText(/Your sign-in could not be removed from here/)).toBeInTheDocument()
    expect(db.conversations.size).toBe(0)
    expect(db.names.size).toBe(0)
  })
})

describe('a guest who signs in', () => {
  it('is asked before their conversation goes into the account, and can say no', async () => {
    chat.mockResolvedValue(reply('Okay.'))
    render(<App />)
    await screen.findByRole('button', { name: 'Sign in' })
    await say('A guest question.')
    await screen.findByText('Okay.')
    await signIn()

    const ask = screen.getByRole('region', { name: 'Save this conversation to your account?' })
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep it in this tab only' }))
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(db.conversations.size).toBe(0)
    expect(screen.getByText('Kept in this tab only.')).toBeInTheDocument()
  })

  it('can save the guest conversation to the new account', async () => {
    chat.mockResolvedValue(reply('Okay.'))
    render(<App />)
    await screen.findByRole('button', { name: 'Sign in' })
    await say('A guest question.')
    await screen.findByText('Okay.')
    await signIn()

    await userEvent.click(screen.getByRole('button', { name: 'Save to my account' }))
    await vi.waitFor(() => expect([...db.conversations.values()][0]?.messages).toHaveLength(2))
  })
})

describe('signing in', () => {
  it('confirms the email with a code when the account is not verified yet', async () => {
    authState.failNextSignIn = { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' }
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    let dialog = screen.getByRole('dialog', { name: 'Sign in to Hetu' })
    await userEvent.type(within(dialog).getByLabelText('Email'), 'new@example.com')
    await userEvent.type(within(dialog).getByLabelText('Password'), 'long enough')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign in' }))

    dialog = await screen.findByRole('dialog', { name: 'Confirm your email' })
    expect(authState.calls).toContain('sendCode:new@example.com')
    await userEvent.type(within(dialog).getByLabelText('Code from the email'), '000000')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm email' }))
    expect(await within(dialog).findByText(/That code is not valid/)).toBeInTheDocument()

    await userEvent.clear(within(dialog).getByLabelText('Code from the email'))
    await userEvent.type(within(dialog).getByLabelText('Code from the email'), '123456')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm email' }))
    expect(await screen.findByRole('button', { name: 'Account: new' })).toBeInTheDocument()
  })

  it('creates an account and asks for the emailed code when confirmation is required', async () => {
    authState.verified = false
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }))
    const dialog = screen.getByRole('dialog', { name: 'Create an account' })
    await userEvent.type(within(dialog).getByLabelText('Email'), 'sam@example.com')
    await userEvent.type(within(dialog).getByLabelText('Password'), 'long enough')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('dialog', { name: 'Confirm your email' })).toBeInTheDocument()
    expect(authState.calls).toContain('signUp:sam@example.com')
  })

  it('resets a forgotten password with an emailed code and signs in', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    await userEvent.click(screen.getByRole('button', { name: 'Forgot your password?' }))
    let dialog = screen.getByRole('dialog', { name: 'Reset your password' })
    await userEvent.type(within(dialog).getByLabelText('Email'), 'ada@example.com')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send a reset code' }))

    dialog = await screen.findByRole('dialog', { name: 'Choose a new password' })
    await userEvent.type(within(dialog).getByLabelText('Code from the email'), '654321')
    await userEvent.type(within(dialog).getByLabelText('New password'), 'a new password')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Set password and sign in' }))

    expect(await screen.findByRole('button', { name: 'Account: ada' })).toBeInTheDocument()
    expect(authState.calls).toEqual(['forgot:ada@example.com', 'reset:ada@example.com:654321', 'signIn:ada@example.com'])
  })

  it('starts Google and GitHub sign-in with a return address on this site', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }))
    expect(authState.socialOptions).toEqual({ provider: 'github', callbackURL: window.location.origin + '/' })
  })

  it('shows a clear message for a wrong password', async () => {
    authState.failNextSignIn = { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid' }
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    const dialog = screen.getByRole('dialog', { name: 'Sign in to Hetu' })
    await userEvent.type(within(dialog).getByLabelText('Email'), 'ada@example.com')
    await userEvent.type(within(dialog).getByLabelText('Password'), 'wrong')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign in' }))
    expect(await within(dialog).findByText('That email and password do not match.')).toBeInTheDocument()
  })
})
