import { describe, expect, it } from 'vitest'

import {
  displayModelName,
  formatCreditLabel,
  formatModelStatusLabel,
  reasoningEffortLabel,
  UNKNOWN_CREDIT_LABEL
} from './model-status-label'

describe('model-status-label', () => {
  it('formats display names consistently', () => {
    expect(displayModelName('anthropic/claude-opus-4.8-fast')).toBe('Opus 4.8')
    expect(displayModelName('openai/gpt-5.5-fast')).toBe('GPT-5.5')
    expect(displayModelName('deepseek/deepseek-v4-pro-thinking')).toBe('Deepseek V4 Pro')
    expect(displayModelName('openai/gpt-5.5')).toBe('GPT-5.5')
  })

  it('maps reasoning effort to compact labels', () => {
    expect(reasoningEffortLabel('high')).toBe('High')
    expect(reasoningEffortLabel('xhigh')).toBe('Max')
    expect(reasoningEffortLabel('')).toBe('')
  })

  it('appends fast + effort session state to the status label', () => {
    expect(formatModelStatusLabel('openai/gpt-5.5', { fastMode: true, reasoningEffort: 'high' })).toBe(
      'GPT-5.5 · Fast High'
    )
  })

  it('always surfaces the effort (default medium) so the level is visible', () => {
    expect(formatModelStatusLabel('openai/gpt-5.5', { reasoningEffort: 'medium' })).toBe('GPT-5.5 · Med')
    expect(formatModelStatusLabel('openai/gpt-5.5')).toBe('GPT-5.5 · Med')
  })

  it('returns just the placeholder name when there is no model', () => {
    expect(formatModelStatusLabel('')).toBe('No model')
  })

  it('formats the remaining-credit label with a trailing currency symbol', () => {
    expect(formatCreditLabel(19.11)).toBe('19.11$')
    expect(formatCreditLabel(0)).toBe('0.00$')
    expect(formatCreditLabel(1234.56)).toBe('1.2k$')
    expect(formatCreditLabel(19.11, 'CNY')).toBe('19.11CNY')
    expect(formatCreditLabel(Number.NaN)).toBe('')
  })

  it('prefixes the credit before the model name and effort', () => {
    expect(
      formatModelStatusLabel('deepseek/deepseek-v4-flash', {
        credit: '19.11$',
        reasoningEffort: 'medium'
      })
    ).toBe('19.11$ · Deepseek V4 Flash · Med')
  })

  it('leaves the label untouched when no credit is known', () => {
    expect(formatModelStatusLabel('deepseek/deepseek-v4-flash', { credit: '', reasoningEffort: 'medium' })).toBe(
      'Deepseek V4 Flash · Med'
    )
  })

  it('uses a placeholder that cannot be mistaken for an empty wallet', () => {
    // Unknown → "00.00$"; a genuine zero balance still renders "0.00$".
    expect(UNKNOWN_CREDIT_LABEL).toBe('00.00$')
    expect(formatCreditLabel(0)).toBe('0.00$')
    expect(formatModelStatusLabel('xai-oauth/grok-4.5', { credit: UNKNOWN_CREDIT_LABEL })).toBe(
      '00.00$ · Grok 4.5 · Med'
    )
  })

  it('reports the effort DeepSeek will actually run, not the internal level', () => {
    // DeepSeek has no `medium`: the API accepts it but coerces to the `high`
    // default, so showing "Med" would be a lie about what the model runs.
    expect(formatModelStatusLabel('deepseek/deepseek-flash', { provider: 'deepseek' })).toBe(
      'Deepseek Flash · High'
    )
    expect(
      formatModelStatusLabel('deepseek/deepseek-flash', { provider: 'deepseek', reasoningEffort: 'medium' })
    ).toBe('Deepseek Flash · High')
    expect(
      formatModelStatusLabel('deepseek/deepseek-flash', { provider: 'deepseek', reasoningEffort: 'low' })
    ).toBe('Deepseek Flash · Low')
    // Hermes' xhigh maps to DeepSeek's `max` — the level that also busts the cache.
    expect(
      formatModelStatusLabel('deepseek/deepseek-v4-pro', { provider: 'deepseek', reasoningEffort: 'xhigh' })
    ).toBe('Deepseek V4 Pro · Max')
  })

  it('keeps provider-vocabulary labels for providers that do have medium', () => {
    expect(
      formatModelStatusLabel('anthropic/claude-opus-4.8', { provider: 'anthropic', reasoningEffort: 'medium' })
    ).toBe('Opus 4.8 · Med')
  })

  it('prefixes credit in front of the effective effort', () => {
    expect(
      formatModelStatusLabel('deepseek/deepseek-flash', {
        credit: '19.11$',
        provider: 'deepseek',
        reasoningEffort: 'medium'
      })
    ).toBe('19.11$ · Deepseek Flash · High')
  })
})
