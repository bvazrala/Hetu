import { useEffect, type RefObject } from 'react'

/**
 * Opens and closes a native <dialog> as a modal when `open` changes.
 * `onOpen` runs each time it opens, to reset the dialog's fields.
 * Where the dialog methods are missing, as in jsdom, the `open` attribute is used.
 */
export function useModal(ref: RefObject<HTMLDialogElement | null>, open: boolean, onOpen?: () => void) {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const isOpen = element.hasAttribute('open')
    if (open && !isOpen) {
      onOpen?.()
      if (typeof element.showModal === 'function') element.showModal()
      else element.setAttribute('open', '')
    } else if (!open && isOpen) {
      if (typeof element.close === 'function') element.close()
      else element.removeAttribute('open')
    }
    // onOpen is a reset for the moment of opening, not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, open])
}
