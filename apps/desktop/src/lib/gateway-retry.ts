/**
 * Which failed gateway requests may be re-sent after a reconnect.
 *
 * "not connected" means the frame never left the client, so any method can be
 * retried. "connection closed" means the frame may already have reached the
 * server before the socket dropped; re-sending a non-idempotent method then
 * runs it twice (a prompt.submit after a WS blip ran the turn twice, masked
 * first as 4009 "session busy").
 */
const NON_IDEMPOTENT_METHODS = new Set([
  'approval.respond',
  'clarify.respond',
  'cli.exec',
  'prompt.submit',
  'secret.respond',
  'session.branch',
  'session.compress',
  'session.create',
  'session.delete',
  'session.rewind',
  'session.undo',
  'shell.exec',
  'slash.exec',
  'sudo.respond'
])

export function isNonIdempotentGatewayMethod(method: string): boolean {
  return NON_IDEMPOTENT_METHODS.has(method)
}

export function shouldRetryGatewayRequest(method: string, errorMessage: string): boolean {
  if (/not connected/i.test(errorMessage)) {
    return true
  }

  if (/connection closed/i.test(errorMessage)) {
    return !isNonIdempotentGatewayMethod(method)
  }

  return false
}
