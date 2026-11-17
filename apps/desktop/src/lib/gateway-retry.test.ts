import { describe, expect, it } from 'vitest'

import { shouldRetryGatewayRequest } from './gateway-retry'

describe('shouldRetryGatewayRequest', () => {
  it('retries anything that was never sent', () => {
    expect(shouldRetryGatewayRequest('prompt.submit', 'Hermes gateway is not connected')).toBe(true)
    expect(shouldRetryGatewayRequest('session.list', 'Hermes gateway is not connected')).toBe(true)
  })

  it('retries idempotent reads after a mid-flight close', () => {
    expect(shouldRetryGatewayRequest('session.list', 'Hermes gateway connection closed')).toBe(true)
    expect(shouldRetryGatewayRequest('session.resume', 'Hermes gateway connection closed')).toBe(true)
    expect(shouldRetryGatewayRequest('config.get', 'Hermes gateway connection closed')).toBe(true)
  })

  it('never re-sends a prompt or another non-idempotent call that may have landed', () => {
    expect(shouldRetryGatewayRequest('prompt.submit', 'Hermes gateway connection closed')).toBe(false)
    expect(shouldRetryGatewayRequest('session.create', 'Hermes gateway connection closed')).toBe(false)
    expect(shouldRetryGatewayRequest('shell.exec', 'Hermes gateway connection closed')).toBe(false)
  })

  it('does not retry other errors', () => {
    expect(shouldRetryGatewayRequest('session.list', 'request timed out: session.list')).toBe(false)
    expect(shouldRetryGatewayRequest('session.list', 'session not found')).toBe(false)
  })
})
