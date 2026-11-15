// Reads and writes a signed-in student's saved work through the Neon Data
// API. Every request carries the user's token, and row-level security in the
// database returns and accepts only that user's rows (db/migrations). No
// function here names a user: the database takes the owner from the token.

import { database } from './neon'
import type { Intent, LearningState, ProofInspection, Specialist, ToolCheck, Assist } from './types'

/** A conversation as listed in the history. */
export interface ConversationSummary {
  id: string
  title: string
  updated_at: string
}

/** Extras saved with a message. Small by design: no copies of the workspace. */
export interface MessageMeta {
  assist?: Assist
  action?: string
  specialists?: Specialist[]
  checks?: ToolCheck[]
  inspection?: ProofInspection | null
  workspaceIncluded?: boolean
}

export interface StoredMessage {
  role: 'student' | 'hetu'
  content: string
  meta: MessageMeta | null
}

export interface StoredConversation {
  intent: Intent | null
  messages: StoredMessage[]
  notes: LearningState | null
}

export interface StoredWorkspace {
  problem: string
  draft: string
}

/** The operations Hetu needs on saved work. Tests replace it with a fake. */
export interface Store {
  listConversations(): Promise<ConversationSummary[]>
  createConversation(title: string, intent: Intent | null): Promise<string>
  renameConversation(id: string, title: string): Promise<void>
  deleteConversation(id: string): Promise<void>
  loadConversation(id: string): Promise<StoredConversation>
  appendMessage(conversationId: string, message: StoredMessage): Promise<void>
  saveNotes(conversationId: string, notes: LearningState): Promise<void>
  loadWorkspace(): Promise<StoredWorkspace | null>
  saveWorkspace(workspace: StoredWorkspace): Promise<void>
  loadDisplayName(): Promise<string | null>
  saveDisplayName(name: string | null): Promise<void>
  deleteAllData(): Promise<void>
}

/** A failure to read or save. The message is safe to show. */
export class StoreError extends Error {}

export const UNAVAILABLE = 'Saving is unavailable right now.'
const HISTORY_LIMIT = 100
export const MAX_TITLE_CHARS = 120

/** A short title from the student's first message. */
export function titleFrom(text: string): string {
  const line = text.replace(/^>.*$/gm, '').replace(/\s+/g, ' ').trim() || text.replace(/\s+/g, ' ').trim()
  return line.length <= 60 ? line : `${line.slice(0, 57).trimEnd()}…`
}

function check<T>(result: { data: T; error: unknown }): T {
  // A database that is over its free quota, asleep past its limit, or
  // unreachable all look the same from here, and the student's next step is
  // the same: keep working in this tab and try again later.
  if (result.error) throw new StoreError(UNAVAILABLE)
  return result.data
}

async function attempt<T>(work: () => PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  try {
    return check(await work())
  } catch (error) {
    if (error instanceof StoreError) throw error
    throw new StoreError(UNAVAILABLE)
  }
}

function neonStore(): Store {
  const db = database!
  return {
    async listConversations() {
      const rows = await attempt(() =>
        db
          .from('conversations')
          .select('id, title, updated_at')
          .order('updated_at', { ascending: false })
          .limit(HISTORY_LIMIT),
      )
      return (rows ?? []) as ConversationSummary[]
    },

    async createConversation(title, intent) {
      const row = await attempt(() =>
        db
          .from('conversations')
          .insert({ title: title.slice(0, MAX_TITLE_CHARS) || 'Untitled', intent })
          .select('id')
          .single(),
      )
      return (row as { id: string }).id
    },

    async renameConversation(id, title) {
      await attempt(() =>
        db
          .from('conversations')
          .update({ title: title.slice(0, MAX_TITLE_CHARS) })
          .eq('id', id),
      )
    },

    async deleteConversation(id) {
      // Messages and notes go with it, by the foreign keys in the schema.
      await attempt(() => db.from('conversations').delete().eq('id', id))
    },

    async loadConversation(id) {
      const [conversation, messages, notes] = await Promise.all([
        attempt(() => db.from('conversations').select('intent').eq('id', id).single()),
        attempt(() => db.from('messages').select('role, content, meta').eq('conversation_id', id).order('id')),
        attempt(() => db.from('learning_states').select('state').eq('conversation_id', id).maybeSingle()),
      ])
      return {
        intent: ((conversation as { intent: Intent | null } | null)?.intent ?? null) as Intent | null,
        messages: (messages ?? []) as StoredMessage[],
        notes: ((notes as { state: LearningState } | null)?.state ?? null) as LearningState | null,
      }
    },

    async appendMessage(conversationId, message) {
      await attempt(() => db.from('messages').insert({ conversation_id: conversationId, ...message }))
    },

    async saveNotes(conversationId, notes) {
      await attempt(() =>
        db
          .from('learning_states')
          .upsert({ conversation_id: conversationId, state: notes }, { onConflict: 'conversation_id' }),
      )
    },

    async loadWorkspace() {
      const row = await attempt(() => db.from('workspaces').select('problem, draft').maybeSingle())
      return (row as StoredWorkspace | null) ?? null
    },

    async saveWorkspace(workspace) {
      // The owner column fills itself from the token, so it is the conflict key.
      await attempt(() => db.from('workspaces').upsert(workspace, { onConflict: 'user_id' }))
    },

    async loadDisplayName() {
      const row = await attempt(() => db.from('profiles').select('display_name').maybeSingle())
      return (row as { display_name: string | null } | null)?.display_name ?? null
    },

    async saveDisplayName(name) {
      await attempt(() => db.from('profiles').upsert({ display_name: name }, { onConflict: 'user_id' }))
    },

    async deleteAllData() {
      // A delete through the Data API needs a filter. Row-level security
      // already limits each one to the user's own rows.
      await attempt(() => db.from('conversations').delete().not('id', 'is', null))
      await attempt(() => db.from('workspaces').delete().not('user_id', 'is', null))
      await attempt(() => db.from('profiles').delete().not('user_id', 'is', null))
    },
  }
}

/** The store for signed-in users, or null when accounts are not configured. */
export const store: Store | null = database ? neonStore() : null
