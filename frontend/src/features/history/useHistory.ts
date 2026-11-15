import { useCallback, useEffect, useState } from 'react'
import type { ConversationSummary, Store } from '../../lib/store'

interface Loaded {
  /** The user the list belongs to, so another user never sees it, even briefly. */
  owner: string
  items: ConversationSummary[]
}

/** The signed-in student's saved conversations, newest first. */
export function useHistory(store: Store | null, userId: string | null, refreshKey: unknown) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!store || !userId) return
    try {
      const items = await store.listConversations()
      setLoaded({ owner: userId, items })
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The history could not be loaded.')
    }
  }, [store, userId])

  useEffect(() => {
    if (!store || !userId) return
    let cancelled = false
    store.listConversations().then(
      (items) => {
        if (cancelled) return
        setLoaded({ owner: userId, items })
        setError(null)
      },
      (caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'The history could not be loaded.')
      },
    )
    return () => {
      cancelled = true
    }
  }, [store, userId, refreshKey])

  const mine = store && userId && loaded?.owner === userId ? loaded.items : null

  function update(change: (items: ConversationSummary[]) => ConversationSummary[]) {
    setLoaded((current) => (current && current.owner === userId ? { ...current, items: change(current.items) } : current))
  }

  async function rename(id: string, title: string) {
    if (!store || title.trim() === '') return
    const previous = mine ?? []
    update((items) => items.map((item) => (item.id === id ? { ...item, title: title.trim() } : item)))
    try {
      await store.renameConversation(id, title.trim())
    } catch {
      update(() => previous)
      setError('The new name could not be saved.')
    }
  }

  async function remove(id: string): Promise<boolean> {
    if (!store) return false
    try {
      await store.deleteConversation(id)
      update((items) => items.filter((item) => item.id !== id))
      return true
    } catch {
      setError('That conversation could not be deleted. Try again in a moment.')
      return false
    }
  }

  return {
    items: mine ?? [],
    loading: Boolean(store && userId) && mine === null && error === null,
    error: store ? error : null,
    reload,
    rename,
    remove,
  }
}

export type History = ReturnType<typeof useHistory>
