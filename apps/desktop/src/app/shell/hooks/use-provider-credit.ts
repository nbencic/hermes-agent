import { useEffect, useState } from 'react'

import { formatCreditLabel, UNKNOWN_CREDIT_LABEL } from '@/lib/model-status-label'

type GatewayRequester = <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>

interface CreditBalanceResponse {
  amount?: number
  available?: boolean
  currency?: string
  provider?: string
}

/** Providers' balances move by cents per turn — a minute of staleness is plenty
 *  and keeps us far away from provider rate limits (the gateway memoises too). */
const REFRESH_MS = 60_000

/**
 * Remaining prepaid credit for the active model provider, formatted for the
 * footer chip (`19.11$`). Always returns a label while enabled: providers with
 * no queryable balance (OAuth/subscription plans, admin-key-gated APIs, local
 * models) get the `00.00$` placeholder instead of dropping the prefix, so the
 * chip keeps a stable shape across provider switches.
 */
export function useProviderCredit(
  requestGateway: GatewayRequester,
  provider: string,
  options?: { enabled?: boolean; refreshMs?: number }
): string | undefined {
  const enabled = options?.enabled ?? true
  const refreshMs = options?.refreshMs ?? REFRESH_MS
  const [label, setLabel] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!enabled) {
      setLabel(undefined)

      return
    }

    // Unknown-yet state: placeholder, never the previous provider's number.
    setLabel(UNKNOWN_CREDIT_LABEL)

    const normalized = provider.trim().toLowerCase()

    if (!normalized) {
      return
    }

    let cancelled = false

    const load = async () => {
      try {
        const credit = await requestGateway<CreditBalanceResponse>('credits.balance', { provider: normalized })

        if (cancelled) {
          return
        }

        const amount = credit?.amount
        setLabel(
          credit?.available && typeof amount === 'number' && Number.isFinite(amount)
            ? formatCreditLabel(amount, credit.currency) || UNKNOWN_CREDIT_LABEL
            : UNKNOWN_CREDIT_LABEL
        )
      } catch {
        // Old gateway / transient failure: keep the placeholder, never blank.
        if (!cancelled) {
          setLabel(UNKNOWN_CREDIT_LABEL)
        }
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), refreshMs)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [enabled, provider, refreshMs, requestGateway])

  return label
}
