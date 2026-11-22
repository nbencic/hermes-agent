import type { SidebarSessionSort } from '@/store/layout'
import type { SessionInfo } from '@/types/hermes'

/**
 * Recents order. 'recent' puts the last-used session first (last message,
 * falling back to creation), so a chat you just continued rises to the top;
 * 'created' is the older creation-time order, where a new message never
 * moves a row. Ties break on creation time, then id, so the order is stable
 * across refreshes.
 */
export function sortSessionsForSidebar(sessions: readonly SessionInfo[], sort: SidebarSessionSort): SessionInfo[] {
  const created = (s: SessionInfo) => s.started_at || 0
  const used = (s: SessionInfo) => s.last_active || s.started_at || 0

  return [...sessions].sort((a, b) => {
    if (sort === 'recent') {
      const delta = used(b) - used(a)

      if (delta) {
        return delta
      }
    }

    return created(b) - created(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  })
}

export function resolveManualSessionOrderIds(currentIds: string[], orderIds: string[], manual: boolean): string[] {
  if (!manual || !currentIds.length || !orderIds.length) {
    return []
  }

  const current = new Set(currentIds)
  const retained = orderIds.filter(id => current.has(id))

  if (!retained.length) {
    return []
  }

  const retainedSet = new Set(retained)
  const fresh = currentIds.filter(id => !retainedSet.has(id))

  return [...fresh, ...retained]
}
