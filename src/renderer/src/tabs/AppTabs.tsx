import { t, useLocale } from '../i18n/LocaleContext'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { NavigationType, Router, createPath, parsePath, UNSAFE_LocationContext, UNSAFE_NavigationContext, type Location, type Navigator, type To } from 'react-router-dom'
import { Play, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { MouseHistoryNavigation } from './mouseNavigation'
import { TAB_SESSION_KEY, decodeTabSession, encodeTabSession, type SavedTab } from './tabSession'
import { beginPointerTabSort } from './pointerReorder'

interface Tab extends SavedTab {
  scroll: number
  revision: number
}
interface TabsValue {
  tabs: Tab[]
  activeId: string
  open: (path?: string, background?: boolean, title?: string) => void
  select: (id: string) => void
  close: (id: string) => void
  closeAll: () => void
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
  const [initial] = useState(() => {
    let restored = null
    try { restored = decodeTabSession(window.localStorage.getItem(TAB_SESSION_KEY)) } catch { /* storage unavailable */ }
    if (restored) return {
      tabs: restored.tabs.map((tab): Tab => ({ ...tab, scroll: 0, revision: 0 })),
      activeId: restored.activeId
    }
    const home = makeTab(window.location.hash.slice(1) || '/')
    return { tabs: [home], activeId: home.id }
  })
  const [tabs, setTabs] = useState<Tab[]>(initial.tabs)
  const [activeId, setActiveId] = useState(initial.activeId)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const saveSession = () => {
    try { window.localStorage.setItem(TAB_SESSION_KEY,
      encodeTabSession(tabsRef.current, activeIdRef.current)) }
    catch (error) { console.warn('[tabs] session storage unavailable', error) }
  }
  // Commit synchronously after every tab change. beforeunload catches app
  // shutdown and pagehide; neither relies on waiting for a debounce timer.
  useLayoutEffect(saveSession, [tabs, activeId])
  useEffect(() => {
    window.addEventListener('beforeunload', saveSession)
    window.addEventListener('pagehide', saveSession)
    return () => {
      window.removeEventListener('beforeunload', saveSession)
      window.removeEventListener('pagehide', saveSession)
    }
  }, [])
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
      closeAll: () => {
        const home = makeTab()
        setTabs([home])
        setActiveId(home.id)
        scrolls.current.clear()
      },
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

  // A validated YouTube link always gets a new tab. Pull pending URLs only
  // after React has mounted its tab manager so cold-start messages cannot be
  // lost if the renderer loads later than the OS activation.
  const externalOpen = useRef(value.open)
  externalOpen.current = value.open
  useEffect(() => {
    let disposed = false
    let draining = false
    let again = false
    async function drain() {
      if (disposed) return
      if (draining) { again = true; return }
      draining = true
      try {
        do {
          again = false
          const routes = await window.api.takeExternalYoutubeRoutes()
          if (disposed) break
          for (const route of routes) externalOpen.current(route)
        } while (again && !disposed)
      } catch (error) {
        console.error('[deep-link] unable to collect pending YouTube routes', error)
      } finally {
        draining = false
      }
    }
    const unsubscribe = window.api.onExternalYoutubeRoute(() => { void drain() })
    void drain()
    return () => { disposed = true; unsubscribe() }
  }, [])

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
  const { tabs, activeId, open, select, close, closeAll, reorder } = useAppTabs()
  const [menu, setMenu] = useState<{ x: number; y: number; tabId: string | null } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const sortingRef = useRef<(() => void) | null>(null)
  const flipRef = useRef<Map<string, DOMRect> | null>(null)
  const ignoreClickRef = useRef(false)
  useEffect(() => () => sortingRef.current?.(), [])
  useLayoutEffect(() => {
    const before = flipRef.current
    if (!before || !stripRef.current) return
    flipRef.current = null
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const element of stripRef.current.querySelectorAll<HTMLElement>(':scope > [data-tab-id]')) {
      const previous = before.get(element.dataset.tabId!)
      if (!previous) continue
      const next = element.getBoundingClientRect()
      const dx = previous.left - next.left
      if (Math.abs(dx) > 0.5) {
        element.animate([{ transform: 'translate3d(' + dx + 'px,0,0)' },
          { transform: 'translate3d(0,0,0)' }],
          { duration: 150, easing: 'cubic-bezier(0.2,0.75,0.25,1)' })
      }
    }
  }, [tabs])
  const startSort = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || event.pointerType === 'touch' ||
        (event.target instanceof Element && event.target.closest('[data-tab-close]'))) return
    const strip = stripRef.current
    if (!strip || tabs.length < 2) return
    sortingRef.current?.()
    sortingRef.current = beginPointerTabSort({
      origin: event.currentTarget, strip, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      onDrop: (from, to, before) => { flipRef.current = before; reorder(from, to) },
      onStart: () => setMenu(null),
      onFinish: (moved) => {
        sortingRef.current = null
        if (moved) {
          ignoreClickRef.current = true
          window.setTimeout(() => { ignoreClickRef.current = false }, 0)
        }
      }
    })
  }
  useEffect(() => {
    if (!menu) return
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null)
    }
    const dismissKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    const dismissBlur = () => setMenu(null)
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', dismissKey, true)
    window.addEventListener('blur', dismissBlur)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', dismissKey, true)
      window.removeEventListener('blur', dismissBlur)
    }
  }, [menu])
  const move = (id: string, delta: number) => {
    const index = tabs.findIndex((tab) => tab.id === id)
    const target = tabs[index + delta]
    if (index >= 0 && target) reorder(id, target.id)
    setMenu(null)
  }
  const menuIndex = tabs.findIndex((tab) => tab.id === menu?.tabId)
  return <div className="wt-tabbar sticky top-[60px] z-30 flex h-10 min-w-0 items-center border-b border-neutral-800 bg-neutral-950 px-2"
    onClickCapture={(event) => {
      if (ignoreClickRef.current) { event.preventDefault(); event.stopPropagation(); ignoreClickRef.current = false }
    }}
    onContextMenu={(event) => {
      event.preventDefault()
      event.stopPropagation()
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tab-id]') : null
      setMenu({ x: Math.min(event.clientX, window.innerWidth - 224),
        y: Math.min(event.clientY, window.innerHeight - 166), tabId: target?.dataset.tabId ?? null })
    }}>
    <div ref={stripRef} role="tablist" aria-label={t("Tabs")} className="flex min-w-0 flex-1 select-none gap-1 overflow-x-auto overscroll-x-contain">
      {tabs.map((tab) => {
        const path = tab.entries[tab.index]
        const label = path.startsWith('/watch/') && tab.title ? tab.title : routeTitle(path)
        return <div key={tab.id} data-tab-id={tab.id} onPointerDown={startSort}
          onDragStart={(event) => event.preventDefault()}
          className={`flex h-8 w-48 min-w-28 max-w-48 shrink-0 cursor-grab items-center border-b-2 active:cursor-grabbing ${tab.id === activeId ? 'wt-tab-selected bg-white/5' : 'border-transparent text-neutral-400 hover:bg-neutral-900'}`}>
          <button type="button" role="tab" aria-selected={tab.id === activeId} onClick={() => select(tab.id)} title={label} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 text-left text-xs">
            {playingIds.includes(tab.id) && <Play aria-label={t("Playing")} className="wt-accent-text h-3 w-3 shrink-0" fill="currentColor" strokeWidth={1.8} />}
            <span className="truncate">{label}</span>
          </button>
          <button type="button" data-tab-close onClick={() => close(tab.id)} title={t("Close tab")} aria-label={t("Close {title}", { title: label })} className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded hover:bg-neutral-700"><X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.8} /></button>
        </div>
      })}
      <button type="button" onClick={() => open()} title={t("New tab")} aria-label={t("New tab")} className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded text-xl text-neutral-400 hover:bg-neutral-800">+</button>
    </div>
    {menu && createPortal(<div ref={menuRef} role="menu" aria-label="Tab options"
      className="fixed z-[200] w-52 rounded border border-neutral-700 bg-neutral-900 p-1 shadow-xl"
      style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y) }}>
      {menu.tabId && <>
        <button role="menuitem" disabled={menuIndex <= 0} onClick={() => move(menu.tabId!, -1)}
          className="block w-full cursor-pointer rounded px-3 py-2 text-left text-sm hover:bg-neutral-800 disabled:cursor-default disabled:opacity-40">Move tab left</button>
        <button role="menuitem" disabled={menuIndex >= tabs.length - 1} onClick={() => move(menu.tabId!, 1)}
          className="block w-full cursor-pointer rounded px-3 py-2 text-left text-sm hover:bg-neutral-800 disabled:cursor-default disabled:opacity-40">Move tab right</button>
        <div className="my-1 border-t border-neutral-700" />
      </>}
      <button role="menuitem" onClick={() => { closeAll(); setMenu(null) }}
        className="block w-full cursor-pointer rounded px-3 py-2 text-left text-sm hover:bg-neutral-800">Close all tabs</button>
    </div>, document.body)}
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
