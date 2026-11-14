/**
 * Browser-tab state belongs to the app window, not to the YouTube account.
 * LocalStorage is synchronous so the first React render can restore the
 * selected tab before OS protocol activations arrive from the main process.
 */
export const TAB_SESSION_KEY = 'loktube.tabs.v1'
export interface SavedTab {
  id: string
  entries: string[]
  index: number
  title: string
}
export interface SavedTabSession {
  version: 1
  tabs: SavedTab[]
  activeId: string
}
const MAX_TABS = 30
const MAX_ENTRIES = 50
const MAX_PATH_LENGTH = 2048
const MAX_TITLE_LENGTH = 250
const ID = /^[a-zA-Z0-9_-]{1,80}$/

export function decodeTabSession(raw: string | null): SavedTabSession | null {
  if (!raw || raw.length > 4_500_000) return null
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const state = data as Record<string, unknown>
    if (state.version !== 1 || !Array.isArray(state.tabs)) return null
    const tabs: SavedTab[] = []
    const used = new Set<string>()
    for (const entry of state.tabs.slice(0, MAX_TABS)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const tab = entry as Record<string, unknown>
      if (typeof tab.id !== 'string' || !ID.test(tab.id) || used.has(tab.id) ||
          !Array.isArray(tab.entries)) continue
      const entries = tab.entries.slice(0, MAX_ENTRIES).filter((path): path is string =>
        typeof path === 'string' && path.length <= MAX_PATH_LENGTH &&
        path.startsWith('/') && !path.startsWith('//') && !/[\u0000-\u001f\u007f]/.test(path))
      if (!entries.length) continue
      const index = typeof tab.index === 'number' && Number.isInteger(tab.index)
        ? Math.max(0, Math.min(entries.length - 1, tab.index)) : entries.length - 1
      used.add(tab.id)
      tabs.push({ id: tab.id, entries, index,
        title: typeof tab.title === 'string' ? tab.title.slice(0, MAX_TITLE_LENGTH) : '' })
    }
    if (!tabs.length) return null
    const activeId = typeof state.activeId === 'string' && used.has(state.activeId)
      ? state.activeId : tabs[0].id
    return { version: 1, tabs, activeId }
  } catch { return null }
}

export function encodeTabSession(tabs: SavedTab[], activeId: string): string {
  return JSON.stringify({ version: 1, tabs: tabs.slice(0, MAX_TABS).map(tab => ({
    id: tab.id, entries: tab.entries.slice(-MAX_ENTRIES),
    index: Math.max(0, tab.index - Math.max(0, tab.entries.length - MAX_ENTRIES)),
    title: tab.title.slice(0, MAX_TITLE_LENGTH)
  })), activeId } satisfies SavedTabSession)
}
