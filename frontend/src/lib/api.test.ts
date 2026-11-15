import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnalyzeError, sendChat, setTokenProvider } from './api'

const BODY = { messages: [{ role: 'student' as const, content: 'Hi' }], learning_state: null }

function respond(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }))
}

afterEach(() => {
  vi.restoreAllMocks()
  setTokenProvider(async () => null)
})

describe('requests to the API', () => {
  it('send no Authorization header for a guest', async () => {
    const fetch = respond(200, { reply: 'Hello.' })
    await sendChat(BODY)
    expect((fetch.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it("send a signed-in user's token", async () => {
    setTokenProvider(async () => 'token-123')
    const fetch = respond(200, { reply: 'Hello.' })
    await sendChat(BODY)
    expect((fetch.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('Bearer token-123')
  })

  it('still go out as a guest when the token cannot be read', async () => {
    setTokenProvider(() => Promise.reject(new Error('offline')))
    const fetch = respond(200, { reply: 'Hello.' })
    await sendChat(BODY)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("show the server's reason when a limit is reached", async () => {
    respond(429, { detail: "You have reached today's limit for this device or account. Try again tomorrow." })
    await expect(sendChat(BODY)).rejects.toThrow(new AnalyzeError("You have reached today's limit for this device or account. Try again tomorrow."))
  })
})
