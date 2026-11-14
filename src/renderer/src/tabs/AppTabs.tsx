import { t, useLocale } from '../i18n/LocaleContext'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { NavigationType, Router, createPath, parsePath, UNSAFE_LocationContext, UNSAFE_NavigationContext, type Location, type Navigator, type To } from 'react-router-dom'
import { Play, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { MouseHistoryNavigation } from './mouseNavigation'

interface Tab {
  id: string
  entries: string[]
  index: number
  title: string
  scroll: number
  revision: number
}
interface TabsValue {
  tabs: Tab[]
  activeId: string
  open: (path?: string, background?: boolean, title?: string) => void
  select: (id: string) => void
  close: (id: string) => void
  rename: (id: string, title: string) => void
  reorder: (from: string, to: string) => void
  navigatorFor: (id: string) => Navigator
  refresh: () => void
}
const TabsContext = createContext<TabsValue | null>(null)
const PageTabContext = createContext({ id: '', active: true, revision: 0 })
const makeTab = (path = '/', title = ''): Tab => ({ id: crypto.randomUUID(), entries: [path], index: 0, title, scroll: 0, revision: 0 })
const pathFor = (to: To) => typeof to === 'string' ? to : createPath(to)

export function useAppTabs() {
  const value = useContext(TabsContext)
  if (!value) throw new Error('AppTabsProvider missing')
  return value
}
export const usePageTab = () => useContext(PageTabContext)

export function AppTabsProvider({ children }: { children: ReactNode }) {
  useLocale()
  const [tabs, setTabs] = useState<Tab[]>(() => [makeTab(window.location.hash.slice(1) || '/')])
  const [activeId, setActiveId] = useState(() => tabs[0].id)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const scrolls = useRef(new Map<string, number>())
  const active = tabs.find((tab) => tab.id === activeId) || tabs[0]
  const path = active.entries[active.index]
  const rename = useCallback((id: string, title: string) => setTabs((items) => {
    if (!items.some((tab) => tab.id === id && tab.title !== title)) return items
    return items.map((tab) => tab.id === id ? { ...tab, title } : tab)
  }), [])

  const value = useMemo<TabsValue>(() => {
    const rememberScroll = (id: string) => {
      if (id !== activeId) return
      const tab = tabsRef.current.find((item) => item.id === id)
      if (tab) scrolls.current.set(`${id}:${tab.entries[tab.index]}`, window.scrollY)
    }
    const navigatorFor = (id: string): Navigator => ({
      createHref: (to) => `#${pathFor(to)}`,
      go: (delta) => { rememberScroll(id); setTabs((items) => items.map((tab) => tab.id === id
        ? { ...tab, index: Math.max(0, Math.min(tab.entries.length - 1, tab.index + delta)) } : tab)) },
      push: (to) => { rememberScroll(id); setTabs((items) => items.map((tab) => tab.id === id
        ? { ...tab, entries: [...tab.entries.slice(0, tab.index + 1), pathFor(to)], index: tab.index + 1 } : tab)) },
      replace: (to) => { rememberScroll(id); setTabs((items) => items.map((tab) => tab.id === id
        ? { ...tab, entries: tab.entries.map((entry, index) => index === tab.index ? pathFor(to) : entry) } : tab)) }
    })
    return {
      tabs, activeId,
      navigatorFor,
      refresh: () => setTabs((items) => items.map((tab) => tab.id === activeId ? { ...tab, revision: tab.revision + 1 } : tab)),
      open: (nextPath = '/', background = false, title = '') => {
        const tab = makeTab(nextPath, title)
        setTabs((items) => [...items, tab])
        if (!background) {
          rememberScroll(activeId)
          setActiveId(tab.id)
        }
      },
      select: (id) => {
        rememberScroll(activeId)
        setActiveId(id)
      },
      reorder: (from, to) => setTabs((items) => {
        const source = items.findIndex((tab) => tab.id === from)
        const destination = items.findIndex((tab) => tab.id === to)
        if (source < 0 || destination < 0 || source === destination) return items
        const next = [...items]
        const [tab] = next.splice(source, 1)
        next.splice(destination, 0, tab)
        return next
      }),
      close: (id) => {
        const items = tabsRef.current
        const index = items.findIndex((tab) => tab.id === id)
        if (index < 0) return
        const remaining = items.filter((tab) => tab.id !== id)
        if (!remaining.length) remaining.push(makeTab())
        setTabs(remaining)
        if (id === activeId) setActiveId(remaining[Math.min(index, remaining.length - 1)].id)
        for (const key of scrolls.current.keys()) if (key.startsWith(`${id}:`)) scrolls.current.delete(key)
      },
      rename
    }
  }, [tabs, activeId, rename])

  useLayoutEffect(() => {
    window.history.replaceState(null, '', `#${path}`)
    const top = scrolls.current.get(`${activeId}:${path}`) ?? 0
    const restore = () => window.scrollTo({ top, left: 0, behavior: 'instant' })
    restore()
    // Library views restore their cached selection in an effect; apply again
    // after that content has committed rather than clamping to the old height.
    const frame = requestAnimationFrame(restore)
    return () => cancelAnimationFrame(frame)
  }, [activeId, path])

  useEffect(() => {
    const hashChange = () => {
      const next = window.location.hash.slice(1) || '/'
      if (next !== path) value.navigatorFor(activeId).push(next)
    }
    window.addEventListener('hashchange', hashChange)
    return () => window.removeEventListener('hashchange', hashChange)
  }, [activeId, path, value])

  const currentNavigation = useRef({ activeId, navigatorFor: value.navigatorFor })
  currentNavigation.current = { activeId, navigatorFor: value.navigatorFor }
  useEffect(() => {
    const navigation = new MouseHistoryNavigation((direction) => {
      const { activeId, navigatorFor } = currentNavigation.current
      navigatorFor(activeId).go(direction === 'back' ? -1 : 1)
    })
    const unsubscribe = window.api.onHistoryNavigation((direction) => navigation.handle(direction, 'native'))
    const mouseUp = (event: globalThis.MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return
      event.preventDefault()
      navigation.handle(event.button === 3 ? 'back' : 'forward', 'mouse')
    }
    const preventDefaultNavigation = (event: globalThis.MouseEvent) => {
      if (event.button === 3 || event.button === 4) event.preventDefault()
    }
    window.addEventListener('mouseup', mouseUp, true)
    window.addEventListener('auxclick', preventDefaultNavigation, true)
    return () => {
      unsubscribe()
      window.removeEventListener('mouseup', mouseUp, true)
      window.removeEventListener('auxclick', preventDefaultNavigation, true)
    }
  }, [])

  return <TabsContext.Provider value={value}>
    <Router location={path} navigator={value.navigatorFor(activeId)}>{children}</Router>
  </TabsContext.Provider>
}

export function TabPages({ children }: { children: ReactNode }) {
  useLocale()
  const { tabs, activeId, navigatorFor } = useAppTabs()
  const navigation = useContext(UNSAFE_NavigationContext)
  return <>{tabs.map((tab) => {
    const path = tab.entries[tab.index]
    const parsed = parsePath(path)
    return <div key={tab.id} hidden={tab.id !== activeId}>
      <PageTabContext.Provider value={{ id: tab.id, active: tab.id === activeId, revision: tab.revision }}>
        <UNSAFE_NavigationContext.Provider value={{ ...navigation, navigator: navigatorFor(tab.id) }}>
          <UNSAFE_LocationContext.Provider value={{ location: { pathname: parsed.pathname || '/', search: parsed.search || '', hash: parsed.hash || '', state: null, key: `${tab.id}:${tab.index}` }, navigationType: NavigationType.Pop }}>
            {children}
          </UNSAFE_LocationContext.Provider>
        </UNSAFE_NavigationContext.Provider>
      </PageTabContext.Provider>
    </div>
  })}</>
}

// A tab owns one player, but retains each visited browsing page independently.
// Inactive pages keep their state and frozen URL without becoming active players.
export function TabRoutePages({ children }: { children: ReactNode }) {
  const tab = usePageTab()
  const location = useContext(UNSAFE_LocationContext)
  const path = createPath(location.location)
  // Watch has a single player slot per tab; never retain duplicate slot IDs.
  const pathname = location.location.pathname
  const selected = pathname.startsWith('/watch/') ? '/watch' : pathname === '/search' ? path : pathname
  const pages = useRef(new Map<string, { location: Location; revision: number }>())
  const lastRefresh = useRef(tab.revision)
  const previous = pages.current.get(selected)
  const revision = (previous?.revision ?? 0) + (lastRefresh.current !== tab.revision ? 1 : 0)
  lastRefresh.current = tab.revision
  pages.current.set(selected, { location: location.location, revision })
  // Redirect components must unmount after forwarding rather than redirecting
  // later navigation from a retained hidden page.
  if (selected !== '/profile') pages.current.delete('/profile')
  return <>{[...pages.current].map(([key, page]) => <div key={key} hidden={key !== selected}>
    <PageTabContext.Provider value={{ ...tab, active: tab.active && key === selected, revision: page.revision }}>
      <UNSAFE_LocationContext.Provider value={{ ...location, location: page.location }}>
        {children}
      </UNSAFE_LocationContext.Provider>
    </PageTabContext.Provider>
  </div>)}</>
}

function routeTitle(path: string) {
  if (path.startsWith('/search')) return new URLSearchParams(parsePath(path).search).get('q') || t("Search")
  const labels: Record<string, string> = { '/': t("Home"), '/saved': t("Saved"), '/liked': t('Likes'), '/playlists': t("Playlists"), '/music': t("Music"), '/account': t("Account"), '/history': t("History"), '/subscriptions': t("Subscriptions") }
  return labels[path] || (path.startsWith('/channel') ? t("Channel") : path.startsWith('/collection') ? t("Collection") : 'Video')
}

export function TabBar({ playingIds = [] }: { playingIds?: string[] }) {
  useLocale()
  const { tabs, activeId, open, select, close, reorder } = useAppTabs()
  return <div className="wt-tabbar sticky top-[60px] z-30 flex h-10 min-w-0 items-center border-b border-neutral-800 bg-neutral-950 px-2">
    <div role="tablist" aria-label={t("Tabs")} className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const path = tab.entries[tab.index]
        const label = path.startsWith('/watch/') && tab.title ? tab.title : routeTitle(path)
        return <div key={tab.id} draggable onDragStart={(event) => event.dataTransfer.setData('application/worldtube-tab', tab.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); reorder(event.dataTransfer.getData('application/worldtube-tab'), tab.id) }} className={`flex h-8 w-48 min-w-28 max-w-48 shrink-0 items-center border-b-2 ${tab.id === activeId ? 'wt-tab-selected bg-white/5' : 'border-transparent text-neutral-400 hover:bg-neutral-900'}`}>
          <button type="button" role="tab" aria-selected={tab.id === activeId} onClick={() => select(tab.id)} title={label} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 text-left text-xs">
            {playingIds.includes(tab.id) && <Play aria-label={t("Playing")} className="wt-accent-text h-3 w-3 shrink-0" fill="currentColor" strokeWidth={1.8} />}
            <span className="truncate">{label}</span>
          </button>
          <button type="button" onClick={() => close(tab.id)} title={t("Close tab")} aria-label={t("Close {title}", { title: label })} className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded hover:bg-neutral-700"><X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.8} /></button>
        </div>
      })}
      <button type="button" onClick={() => open()} title={t("New tab")} aria-label={t("New tab")} className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded text-xl text-neutral-400 hover:bg-neutral-800">+</button>
    </div>
  </div>
}

export function TabLinkHandler({ children, onPlayInMiniPlayer }: { children: ReactNode; onPlayInMiniPlayer: (videoId: string) => void }) {
  useLocale()
  const { open } = useAppTabs()
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; title: string; videoId: string | null } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null)
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenu(null); triggerRef.current?.focus() }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      }
    }
    const close = () => setMenu(null)
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', keyboard, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', keyboard, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])
  function contextMenu(event: MouseEvent) {
    if (!(event.target instanceof Element)) return
    const link = event.target.closest<HTMLAnchorElement>('a[href^="#/"]')
    const card = event.target.closest<HTMLElement>('[data-video-id]')
    const path = link?.getAttribute('href')?.slice(1) ?? (card ? `/watch/${card.dataset.videoId}` : null)
    if (!path) return
    event.preventDefault()
    event.stopPropagation()
    const videoId = path.match(/^\/watch\/([\w-]{11})(?:[/?#]|$)/)?.[1] ?? null
    triggerRef.current = link ?? card
    const rect = (link ?? card)?.getBoundingClientRect()
    const x = event.clientX || rect?.left || 0
    const y = event.clientY || rect?.top || 0
    setMenu({ path, videoId, title: card?.dataset.videoTitle ?? link?.textContent?.trim() ?? '',
      x: Math.max(8, Math.min(x, window.innerWidth - 264)), y: Math.max(8, Math.min(y, window.innerHeight - (videoId ? 144 : 104))) })
  }
  function intercept(event: MouseEvent, middle = false) {
    if (middle ? event.button !== 1 : !event.ctrlKey && !event.metaKey) return
    const link = (event.target as Element).closest('a')
    const href = link?.getAttribute('href')
    if (!href?.startsWith('#/')) return
    event.preventDefault()
    event.stopPropagation()
    open(href.slice(1), !event.shiftKey)
  }
  const itemClass = 'block w-full cursor-pointer rounded px-3 py-2 text-left text-sm text-neutral-100 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none'
  return <div onClickCapture={intercept} onAuxClickCapture={(event) => intercept(event, true)} onContextMenu={contextMenu}>
    {children}
    {menu && createPortal(<div ref={menuRef} role="menu" aria-label={t('Video options')} className="fixed z-[200] w-64 rounded border border-neutral-700 bg-neutral-900 p-1 shadow-xl" style={{ left: menu.x, top: menu.y }}>
      <button role="menuitem" className={itemClass} onClick={() => { open(menu.path, true, menu.title); setMenu(null) }}>{t('Open in new tab')}</button>
      <button role="menuitem" className={itemClass} onClick={() => { open(menu.path, false, menu.title); setMenu(null) }}>{t('Open in new tab and switch')}</button>
      {menu.videoId && <button role="menuitem" className={itemClass} onClick={() => { onPlayInMiniPlayer(menu.videoId!); setMenu(null) }}>{t('Play in mini player')}</button>}
    </div>, document.body)}
  </div>
}
