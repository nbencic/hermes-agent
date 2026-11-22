import { describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/types/hermes'

import { resolveManualSessionOrderIds, sortSessionsForSidebar } from './order'

describe('resolveManualSessionOrderIds', () => {
  it('clears legacy auto-seeded order until the user manually reorders sessions', () => {
    expect(resolveManualSessionOrderIds(['newest', 'older'], ['older', 'newest'], false)).toEqual([])
  })

  it('keeps a manual order and surfaces newly seen sessions first', () => {
    expect(resolveManualSessionOrderIds(['newest', 'older', 'oldest'], ['oldest', 'older'], true)).toEqual([
      'newest',
      'oldest',
      'older'
    ])
  })

  it('clears manual order when none of the saved ids still exist', () => {
    expect(resolveManualSessionOrderIds(['newest'], ['gone'], true)).toEqual([])
  })
})


describe('sortSessionsForSidebar', () => {
  const session = (id: string, started_at: number, last_active: number): SessionInfo =>
    ({ id, started_at, last_active }) as SessionInfo

  // created on the 16th, used on the 21st — the case that sank below newer chats
  const old = session('old-but-used', 16, 21)
  const newer = session('newer', 20, 20)
  const newest = session('newest', 22, 22)
  const neverUsed = { ...session('never-used', 19, 0), last_active: 0 }

  it("'recent' puts the last-used session first, falling back to creation", () => {
    expect(sortSessionsForSidebar([newer, old, neverUsed, newest], 'recent').map(s => s.id)).toEqual([
      'newest',
      'old-but-used',
      'newer',
      'never-used'
    ])
  })

  it("'created' keeps creation order regardless of activity", () => {
    expect(sortSessionsForSidebar([old, newer, newest, neverUsed], 'created').map(s => s.id)).toEqual([
      'newest',
      'newer',
      'never-used',
      'old-but-used'
    ])
  })

  it('breaks ties deterministically and does not mutate the input', () => {
    const a = session('a', 5, 5)
    const b = session('b', 5, 5)
    const input = [a, b]

    expect(sortSessionsForSidebar(input, 'recent').map(s => s.id)).toEqual(['b', 'a'])
    expect(sortSessionsForSidebar([b, a], 'recent').map(s => s.id)).toEqual(['b', 'a'])
    expect(input.map(s => s.id)).toEqual(['a', 'b'])
  })
})
