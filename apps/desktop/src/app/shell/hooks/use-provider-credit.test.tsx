import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { UNKNOWN_CREDIT_LABEL } from '@/lib/model-status-label'

import { useProviderCredit } from './use-provider-credit'

const REFRESH = 60_000

describe('useProviderCredit', () => {
  it('formats the gateway balance for the footer chip', async () => {
    const request = vi.fn().mockResolvedValue({ available: true, amount: 19.11, currency: 'USD' })

    const { result } = renderHook(() => useProviderCredit(request, 'deepseek', { refreshMs: REFRESH }))

    await waitFor(() => expect(result.current).toBe('19.11$'))
    expect(request).toHaveBeenCalledWith('credits.balance', { provider: 'deepseek' })
  })

  it('falls back to the 00.00$ placeholder for providers without a balance', async () => {
    const request = vi.fn().mockResolvedValue({ available: false, provider: 'xai-oauth' })

    const { result } = renderHook(() => useProviderCredit(request, 'xai-oauth', { refreshMs: REFRESH }))

    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(result.current).toBe(UNKNOWN_CREDIT_LABEL)
  })

  it('shows the placeholder when the gateway does not know the method yet', async () => {
    const request = vi.fn().mockRejectedValue(new Error('unknown method: credits.balance'))

    const { result } = renderHook(() => useProviderCredit(request, 'deepseek', { refreshMs: REFRESH }))

    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(result.current).toBe(UNKNOWN_CREDIT_LABEL)
  })

  it('never keeps the previous provider number after a switch', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ available: true, amount: 19.11, currency: 'USD' })
      .mockReturnValueOnce(new Promise(() => {}))

    const { result, rerender } = renderHook(
      ({ provider }: { provider: string }) => useProviderCredit(request, provider, { refreshMs: REFRESH }),
      { initialProps: { provider: 'deepseek' } }
    )

    await waitFor(() => expect(result.current).toBe('19.11$'))

    rerender({ provider: 'anthropic' })

    await waitFor(() => expect(result.current).toBe(UNKNOWN_CREDIT_LABEL))
  })

  it('renders a bare chip (no prefix) when the feature is disabled', () => {
    const request = vi.fn()

    const { result } = renderHook(() =>
      useProviderCredit(request, 'deepseek', { enabled: false, refreshMs: REFRESH })
    )

    expect(request).not.toHaveBeenCalled()
    expect(result.current).toBeUndefined()
  })
})
