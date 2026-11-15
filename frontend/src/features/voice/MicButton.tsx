import type { useDictation } from './useDictation'

type Dictation = ReturnType<typeof useDictation>

/** Starts and stops dictation. Its label and look follow the dictation state. */
export function MicButton({ dictation }: { dictation: Dictation }) {
  const { state, listening, toggle } = dictation
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      aria-label={listening ? 'Stop dictation' : 'Dictate a message'}
      title={
        state === 'unsupported'
          ? 'Dictation is not available in this browser'
          : listening
            ? 'Stop dictation'
            : 'Dictate a message'
      }
      className={
        'btn btn-small w-9 px-0 ' +
        (listening ? 'btn-primary' : state === 'unsupported' ? 'btn-quiet opacity-60' : 'btn-secondary')
      }
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
        {listening ? (
          <rect x="6" y="6" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
        ) : (
          <>
            <rect x="7.5" y="2.5" width="5" height="9" rx="2.5" />
            <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
          </>
        )}
      </svg>
    </button>
  )
}
