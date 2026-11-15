import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '../components/ThemeToggle'
import { useTheme } from './useTheme'

function Harness() {
  const theme = useTheme()
  return <ThemeToggle choice={theme.choice} onCycle={theme.cycle} />
}

afterEach(() => {
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('the theme', () => {
  it('follows the system by default and steps through light, dark, and back', async () => {
    render(<Harness />)
    const button = screen.getByRole('button', { name: /^Theme: system/ })
    expect(document.documentElement.dataset.theme).toBe('light')

    await userEvent.click(button)
    expect(button).toHaveAccessibleName('Theme: light. Switch to dark.')
    expect(window.localStorage.getItem('hetu.theme')).toBe('light')

    await userEvent.click(button)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('hetu.theme')).toBe('dark')

    await userEvent.click(button)
    expect(button).toHaveAccessibleName('Theme: system. Switch to light.')
    expect(window.localStorage.getItem('hetu.theme')).toBeNull()
  })

  it('remembers a choice from an earlier visit', () => {
    window.localStorage.setItem('hetu.theme', 'dark')
    render(<Harness />)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByRole('button')).toHaveAccessibleName('Theme: dark. Switch to system.')
  })
})
