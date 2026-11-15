import type { ThemeChoice } from '../lib/useTheme'

interface Props {
  choice: ThemeChoice
  onCycle: () => void
}

const NEXT: Record<ThemeChoice, string> = { system: 'light', light: 'dark', dark: 'system' }
const NAMES: Record<ThemeChoice, string> = { system: 'system', light: 'light', dark: 'dark' }

/** One button that steps through system, light, and dark. The icon shows the current choice. */
export function ThemeToggle({ choice, onCycle }: Props) {
  return (
    <button
      type="button"
      onClick={onCycle}
      aria-label={`Theme: ${NAMES[choice]}. Switch to ${NEXT[choice]}.`}
      title={`Theme: ${NAMES[choice]}`}
      className="btn btn-secondary btn-small w-8 px-0"
    >
      <svg
        viewBox="0 0 20 20"
        width="16"
        height="16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        {choice === 'light' && (
          <>
            <circle cx="10" cy="10" r="3.5" />
            <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4" />
          </>
        )}
        {choice === 'dark' && <path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8Z" />}
        {choice === 'system' && (
          <>
            <circle cx="10" cy="10" r="6.5" />
            <path d="M10 3.5v13" />
            <path d="M10 3.5a6.5 6.5 0 0 1 0 13Z" fill="currentColor" stroke="none" />
          </>
        )}
      </svg>
    </button>
  )
}
