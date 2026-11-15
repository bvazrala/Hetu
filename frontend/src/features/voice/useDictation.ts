import { useEffect, useRef, useState } from 'react'

// The parts of the Web Speech API used here. Browsers that support it expose
// the constructor as SpeechRecognition or webkitSpeechRecognition.
interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}
interface RecognitionEvent {
  resultIndex: number
  results: ArrayLike<RecognitionResult>
}
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionConstructor = new () => Recognition

function recognitionConstructor(): RecognitionConstructor | null {
  const scope = window as unknown as Record<string, RecognitionConstructor | undefined>
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

export type DictationState = 'idle' | 'listening' | 'unsupported' | 'error'

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in your browser settings to dictate.',
  'service-not-allowed': 'This browser does not allow dictation here.',
  'audio-capture': 'No microphone was found.',
  network: 'Dictation needs an internet connection in this browser.',
  'no-speech': 'No speech was heard. Try again when you are ready.',
}

/**
 * Dictation into the message box. The transcript is added to whatever the
 * student already typed, and is never sent on its own.
 *
 * Speech recognition is done by the browser. In Chrome, for example, the
 * audio goes to the browser maker's speech service; it is not processed on
 * the device and Hetu never receives it.
 */
export function useDictation(text: string, setText: (value: string) => void) {
  const Constructor = recognitionConstructor()
  const [state, setState] = useState<DictationState>(Constructor ? 'idle' : 'unsupported')
  const [message, setMessage] = useState<string | null>(null)
  const recognition = useRef<Recognition | null>(null)
  const latest = useRef({ text, setText })
  useEffect(() => {
    latest.current = { text, setText }
  })

  useEffect(() => () => recognition.current?.abort(), [])

  function start() {
    if (!Constructor) {
      setMessage('Dictation is not available in this browser. Typing works as usual.')
      setState('unsupported')
      return
    }
    const before = latest.current.text.trimEnd()
    const instance = new Constructor()
    instance.lang = navigator.language || 'en-US'
    instance.continuous = true
    instance.interimResults = true
    instance.onresult = (event) => {
      let heard = ''
      for (let index = 0; index < event.results.length; index++) heard += event.results[index][0].transcript
      const spoken = heard.trim()
      latest.current.setText(before && spoken ? `${before} ${spoken}` : before || spoken)
    }
    instance.onerror = (event) => {
      if (event.error === 'aborted') return
      setMessage(ERRORS[event.error] ?? 'Dictation stopped because of an error.')
      setState('error')
    }
    instance.onend = () => {
      recognition.current = null
      setState((current) => (current === 'listening' ? 'idle' : current))
    }
    recognition.current = instance
    setMessage(null)
    setState('listening')
    try {
      instance.start()
    } catch {
      setMessage('Dictation could not start. Try again.')
      setState('error')
    }
  }

  function stop() {
    recognition.current?.stop()
  }

  return {
    state,
    message,
    listening: state === 'listening',
    toggle: () => (state === 'listening' ? stop() : start()),
    stop,
  }
}
