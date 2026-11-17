import { JsonRpcGatewayClient } from '@hermes/shared'
import { describe, expect, it, vi } from 'vitest'

class FakeSocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING
  sent: string[] = []
  closed = false

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closed = true
    // Real sockets fire 'close' asynchronously, after the caller returns.
  }

  open() {
    this.readyState = WebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }
}

describe('JsonRpcGatewayClient.close()', () => {
  it('rejects in-flight requests and reports closed instead of hanging until the timeout', async () => {
    const socket = new FakeSocket()

    const client = new JsonRpcGatewayClient({
      closedErrorMessage: 'connection closed',
      socketFactory: () => socket as unknown as WebSocket
    })

    const states: string[] = []
    client.onState(state => states.push(state))

    const connecting = client.connect('ws://test')
    socket.open()
    await connecting
    expect(client.connectionState).toBe('open')

    const pending = client.request('session.list', {}, 60_000)
    const rejection = vi.fn()
    pending.catch(rejection)

    client.close()

    await Promise.resolve()
    await Promise.resolve()
    expect(socket.closed).toBe(true)
    expect(client.connectionState).toBe('closed')
    expect(rejection).toHaveBeenCalledTimes(1)
    expect(String(rejection.mock.calls[0][0])).toMatch(/connection closed/)
    expect(states.at(-1)).toBe('closed')
  })

  it('is a no-op on a client that never connected', () => {
    const client = new JsonRpcGatewayClient()
    expect(() => client.close()).not.toThrow()
    expect(client.connectionState).toBe('idle')
  })
})
