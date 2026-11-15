import { pause, resume, speak, speechSupported, stop, toSpeech, usePlayback } from './speech'

const control = 'btn btn-quiet btn-small px-2'

/** Listen, pause, and stop controls for one of Hetu's replies. Hidden where the browser cannot speak. */
export function ReadAloud({ id, text }: { id: string; text: string }) {
  const playback = usePlayback()
  if (!speechSupported()) return null
  const mine = playback.id === id

  if (!mine) {
    return (
      <button type="button" className={control} onClick={() => speak(id, toSpeech(text))}>
        <SpeakerIcon />
        Listen
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      {playback.state === 'playing' ? (
        <button type="button" className={control} onClick={pause}>
          Pause
        </button>
      ) : (
        <button type="button" className={control} onClick={resume}>
          Resume
        </button>
      )}
      <button type="button" className={control} onClick={stop}>
        Stop
      </button>
      <span role="status" className="sr-only">
        {playback.state === 'playing' ? 'Reading aloud' : 'Paused'}
      </span>
    </span>
  )
}

function SpeakerIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="15"
      height="15"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8h3l4-3.5v11L6 12H3z" />
      <path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.5 6.5 0 0 1 0 9" />
    </svg>
  )
}
