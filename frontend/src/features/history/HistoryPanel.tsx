import { useState } from 'react'
import { MAX_TITLE_CHARS, type ConversationSummary } from '../../lib/store'
import type { History } from './useHistory'

interface Props {
  history: History
  currentId: string | null
  onOpen: (id: string) => void
  onNew: () => void
  /** Called after the open conversation is deleted, so the screen can start fresh. */
  onDeletedCurrent: () => void
}

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

/** The list of saved conversations, with ways to reopen, rename, and delete them. */
export function HistoryPanel({ history, currentId, onOpen, onNew, onDeletedCurrent }: Props) {
  return (
    <nav aria-labelledby="history-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <h2 id="history-heading" className="eyebrow">
          Your conversations
        </h2>
        <button type="button" className="btn btn-secondary btn-small" onClick={onNew}>
          New
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {history.error && <p className="mx-2 mb-2 border-l-2 border-flag pl-2 text-sm">{history.error}</p>}
        {history.items.length === 0 && !history.loading && !history.error && (
          <p className="mx-2 text-sm text-muted">Conversations you have while signed in are saved here.</p>
        )}
        <ul role="list" className="space-y-0.5">
          {history.items.map((item) => (
            <Item
              key={item.id}
              item={item}
              current={item.id === currentId}
              onOpen={() => onOpen(item.id)}
              onRename={(title) => history.rename(item.id, title)}
              onDelete={async () => {
                if ((await history.remove(item.id)) && item.id === currentId) onDeletedCurrent()
              }}
            />
          ))}
        </ul>
      </div>
    </nav>
  )
}

function Item({
  item,
  current,
  onOpen,
  onRename,
  onDelete,
}: {
  item: ConversationSummary
  current: boolean
  onOpen: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const [mode, setMode] = useState<'view' | 'rename' | 'confirm'>('view')
  const [title, setTitle] = useState(item.title)

  if (mode === 'rename') {
    return (
      <li className="px-2 py-1">
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            onRename(title)
            setMode('view')
          }}
        >
          <label htmlFor={`rename-${item.id}`} className="sr-only">
            New name for {item.title}
          </label>
          <input
            id={`rename-${item.id}`}
            autoFocus
            maxLength={MAX_TITLE_CHARS}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setMode('view')}
            className="min-w-0 flex-1 rounded-md border border-accent bg-surface px-2 py-1 text-sm"
          />
          <button type="submit" className="btn btn-quiet btn-small px-2">
            Save
          </button>
        </form>
      </li>
    )
  }

  if (mode === 'confirm') {
    return (
      <li className="rounded-md bg-flag-soft px-3 py-2 text-sm">
        <p>Delete “{item.title}”? This cannot be undone.</p>
        <div className="mt-1 flex gap-1">
          <button type="button" className="btn btn-quiet btn-small px-2 text-ink" onClick={onDelete}>
            Delete
          </button>
          <button type="button" className="btn btn-quiet btn-small px-2" onClick={() => setMode('view')}>
            Keep
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className={'group flex items-center rounded-md ' + (current ? 'bg-accent-soft' : 'hover:bg-surface')}>
      <button
        type="button"
        aria-current={current ? 'page' : undefined}
        onClick={onOpen}
        className="min-w-0 flex-1 px-3 py-2 text-left"
      >
        <span className="block truncate text-sm">{item.title}</span>
        <span className="block text-xs text-muted">{dateFormat.format(new Date(item.updated_at))}</span>
      </button>
      <span className="flex shrink-0 pr-1 lg:hidden lg:group-focus-within:flex lg:group-hover:flex">
        <button
          type="button"
          aria-label={`Rename ${item.title}`}
          title="Rename"
          onClick={() => {
            setTitle(item.title)
            setMode('rename')
          }}
          className="rounded px-1.5 py-1 text-xs text-muted hover:text-ink"
        >
          Rename
        </button>
        <button
          type="button"
          aria-label={`Delete ${item.title}`}
          title="Delete"
          onClick={() => setMode('confirm')}
          className="rounded px-1.5 py-1 text-xs text-muted hover:text-ink"
        >
          Delete
        </button>
      </span>
    </li>
  )
}
