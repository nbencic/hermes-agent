const REASONING_LABELS: Record<string, string> = {
  none: 'Off',
  minimal: 'Min',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'Max'
}

export function reasoningEffortLabel(effort: string): string {
  const key = effort.trim().toLowerCase()

  if (!key) {
    return ''
  }

  return REASONING_LABELS[key] ?? effort
}

/** Strip provider prefix and normalize for display. */
export function modelBaseId(model: string): string {
  const trimmed = model.trim()
  const slash = trimmed.lastIndexOf('/')

  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

// Trailing model-id variants that should render as a grayed tag beside the
// name (e.g. "Opus 4.8" + "Fast") rather than collapsing two distinct ids to
// the same display name.
const VARIANT_TAGS: ReadonlyArray<readonly [RegExp, string]> = [
  [/-fast$/i, 'Fast'],
  [/-thinking$/i, 'Thinking'],
  [/-preview$/i, 'Preview'],
  [/-latest$/i, 'Latest']
]

const titleCase = (text: string): string => text.replace(/\b\w/g, char => char.toUpperCase()).trim()

function prettifyBase(base: string): string {
  if (/^claude-/i.test(base)) {
    return titleCase(base.replace(/^claude-/i, '').replace(/-/g, ' '))
  }

  if (/^gpt-/i.test(base)) {
    return base.replace(/^gpt-/i, 'GPT-')
  }

  if (/^gemini-/i.test(base)) {
    return base.replace(/^gemini-/i, 'Gemini ').replace(/-/g, ' ')
  }

  return titleCase(base.replace(/-/g, ' '))
}

/** Split a model id into a clean display name plus an optional grayed variant
 *  tag, so distinct ids (e.g. `…-4.8` vs `…-4.8-fast`) don't collapse. */
export function modelDisplayParts(model: string): { name: string; tag: string } {
  let base = modelBaseId(model)
  let tag = ''

  for (const [pattern, label] of VARIANT_TAGS) {
    if (pattern.test(base)) {
      tag = label
      base = base.replace(pattern, '')

      break
    }
  }

  return { name: prettifyBase(base) || model.trim() || 'No model', tag }
}

/** Friendly one-line model name for menus and the status bar. */
export function displayModelName(model: string): string {
  return modelDisplayParts(model).name
}

/**
 * Compact remaining-credit label for the status bar chip, e.g. `19.11$`.
 * Trailing symbol (not leading) keeps the number — the part that changes — at a
 * stable left edge, and matches how EU users read prices. Balances at or above
 * $1000 collapse to `1.2k$` so the chip can't crowd out the model name.
 */
export function formatCreditLabel(amount: number, currency = 'USD'): string {
  if (!Number.isFinite(amount)) {
    return ''
  }

  const symbol = currency.trim().toUpperCase() === 'USD' ? '$' : currency.trim().toUpperCase() || '$'
  const rounded = Math.max(0, amount)
  const value = rounded >= 1000 ? `${(rounded / 1000).toFixed(1)}k` : rounded.toFixed(2)

  return `${value}${symbol}`
}

/**
 * Shown when a provider exposes no queryable balance (OAuth/subscription plans,
 * admin-key-gated APIs, local models). Deliberately `00.00$` rather than
 * `0.00$` so an unknown balance can never be misread as an empty wallet —
 * a real zero renders as `0.00$`.
 */
export const UNKNOWN_CREDIT_LABEL = '00.00$'

/**
 * Providers whose reasoning levels don't line up with Hermes' internal scale.
 *
 * Per DeepSeek's official thinking-mode docs
 * (api-docs.deepseek.com/guides/thinking_mode): real levels are low/high/max,
 * thinking is ON by default at effort high, and the API coerces
 * minimal→low, medium→high, xhigh→high, ultra→max. Hermes' backend sends
 * explicit values instead: minimal is sent as "low", xhigh is sent as "max"
 * (so the Max pill reaches the real max tier), and none turns thinking OFF.
 * The map mirrors that wire behaviour so the pill never claims a level the
 * model isn't running. Note max invalidates DeepSeek's prompt cache on an
 * otherwise identical prefix (measured: 93.9% → 0% hit).
 */
interface EffortProfile {
  /** Hermes-internal level → the level the provider will really run. */
  map: Readonly<Record<string, string>>
  /** Provider vocabulary for display. */
  labels: Readonly<Record<string, string>>
  /** Level used when nothing is configured or the value is unrecognised. */
  fallback: string
}

const EFFORT_PROFILES: Readonly<Record<string, EffortProfile>> = {
  deepseek: {
    map: { none: 'off', minimal: 'low', low: 'low', medium: 'high', high: 'high', xhigh: 'max' },
    labels: { off: 'Off', low: 'Low', high: 'High', max: 'Max' },
    fallback: 'high'
  },
  // Z.AI / GLM-5*: thinking cannot be disabled (HTTP 1210 "always engages in
  // thinking; use low, high, or max") — the backend sends the low floor
  // instead, so "Off" really runs Low. The API accepts low/high/max, and
  // Hermes maps minimal→low, medium→high, xhigh→max (probe-verified against
  // api.z.ai/api/paas/v4, glm-5.3-flashx, 2026-11). Server default behaves
  // like high (probe: unset effort ran to the token cap on a multi-step task).
  zai: {
    map: { none: 'low', minimal: 'low', low: 'low', medium: 'high', high: 'high', xhigh: 'max', max: 'max' },
    labels: { low: 'Low', high: 'High', max: 'Max' },
    fallback: 'high'
  }
}

function effortProfile(provider?: string): EffortProfile | undefined {
  const key = (provider ?? '').trim().toLowerCase()

  if (!key) {
    return undefined
  }

  // Provider ids arrive as `deepseek` or (for proxied setups) something like
  // `deepseek-flash`; match on the family name.
  const family = Object.keys(EFFORT_PROFILES).find(name => key === name || key.startsWith(`${name}-`))

  return family ? EFFORT_PROFILES[family] : undefined
}

/** The level a provider will actually run, plus its display label. */
export function effectiveEffort(effort: string, provider?: string): { level: string; label: string } {
  const key = effort.trim().toLowerCase()
  const profile = effortProfile(provider)

  if (!profile) {
    return { level: key, label: reasoningEffortLabel(effort) || 'Med' }
  }

  const level = (key && profile.map[key]) || profile.fallback

  return { level, label: profile.labels[level] ?? level }
}

/** Status bar trigger label — model name plus the live session state (effort/fast). */
export function formatModelStatusLabel(
  model: string,
  options?: { credit?: string; fastMode?: boolean; provider?: string; reasoningEffort?: string }
): string {
  const name = displayModelName(model)

  if (!model.trim()) {
    return name
  }

  const parts: string[] = []

  // Fast is shown when the speed=fast param is on (options.fastMode) OR the
  // active model is a `…-fast` variant (fast via a separate model id).
  if (options?.fastMode || /-fast$/i.test(modelBaseId(model))) {
    parts.push('Fast')
  }

  // Always surface the effort (empty = the provider's default) so the current
  // reasoning level is visible at a glance, not just when non-default. The label
  // is the level the provider will ACTUALLY run — see EFFORT_PROFILES.
  parts.push(effectiveEffort(options?.reasoningEffort ?? '', options?.provider).label)

  const body = `${name} · ${parts.join(' ')}`
  const credit = options?.credit?.trim()

  return credit ? `${credit} · ${body}` : body
}
