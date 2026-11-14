export type Mode = 'freeform' | 'structured'

const MODES: { value: Mode; label: string }[] = [
  { value: 'freeform', label: 'Freeform' },
  { value: 'structured', label: 'Structured' },
]

interface Props {
  mode: Mode
  onChange: (mode: Mode) => void
}

export function ModeToggle({ mode, onChange }: Props) {
  return (
    <div role="group" aria-label="View" className="inline-flex rounded-md border border-rule bg-surface p-0.5">
      {MODES.map(({ value, label }) => {
        const active = mode === value
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(value)}
            className={
              'rounded px-3 py-1.5 text-sm font-medium transition-colors ' +
              (active ? 'bg-accent text-white' : 'text-muted hover:text-ink')
            }
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
