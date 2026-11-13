import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAppTabs } from '../tabs/AppTabs'
import { GlobalPlayerContext, initialState, useGlobalPlayer, type GlobalPlayerContextValue } from './GlobalPlayerContext'
import { PLAYER_COMMAND_EVENT, PLAYER_STATE_EVENT, type PlayerStateDetail } from './events'
import { MINI_PLAYER_OPEN_EVENT } from './events'

interface WorkspaceValue {
  register: (id: string, player: GlobalPlayerContextValue | null) => void
  ownerId: string
  playingIds: string[]
  requestPlayback: (id: string) => void
  shouldAutoplay: (id: string) => boolean
  playInMiniPlayer: (videoId: string) => void
}
const WorkspaceContext = createContext<WorkspaceValue | null>(null)
const emptyPlayer: GlobalPlayerContextValue = {
  ...initialState, ownerTabId: '', playbackMode: 'video', musicQueue: [], musicSourcePath: null, videoQueue: [], shorts: [], playVideo: async () => {}, playVideoQueue: async () => {}, playMusic: async () => {}, extendVideoQueue: () => {}, extendMusicQueue: () => {},
  closePlayer: () => {}, openShort: () => {}, dismissShorts: () => {}
}

export function usePlayerWorkspace() {
  const workspace = useContext(WorkspaceContext)
  if (!workspace) throw new Error('PlayerWorkspaceProvider missing')
  return workspace
}

export function PlayerWorkspaceProvider({ children }: { children: ReactNode }) {
  const { activeId, tabs, navigatorFor } = useAppTabs()
  const [players, setPlayers] = useState<Record<string, GlobalPlayerContextValue>>({})
  const [preferredId, setPreferredId] = useState('')
  const [playingIds, setPlayingIds] = useState<string[]>([])
  const autoplayOwner = useRef('')
  const requestPlayback = useCallback((id: string) => {
    autoplayOwner.current = id
    window.dispatchEvent(new CustomEvent(PLAYER_COMMAND_EVENT, { detail: { action: 'pause-others', tabId: id } }))
  }, [])
  const shouldAutoplay = useCallback((id: string) => !autoplayOwner.current || autoplayOwner.current === id, [])
  const register = useCallback((id: string, player: GlobalPlayerContextValue | null) => {
    setPlayers((current) => {
      if (current[id] === player || (!player && !current[id])) return current
      const next = { ...current }
      if (player) next[id] = player
      else delete next[id]
      return next
    })
  }, [])
  const available = (id: string) => tabs.some((tab) => tab.id === id) && !!players[id]?.videoId
  const ownerId = available(activeId) ? activeId : available(preferredId) ? preferredId
    : [...tabs].reverse().find((tab) => available(tab.id))?.id || ''
  const selected = players[ownerId] || emptyPlayer
  const playInMiniPlayer = useCallback((videoId: string) => {
    const player = players[activeId]
    if (!player) return
    requestPlayback(activeId)
    setPreferredId(activeId)
    player.dismissShorts()
    const tab = tabs.find((candidate) => candidate.id === activeId)
    // Browsing pages stay in place. Leave a full-size watch page so its player
    // can move into the existing mini-player slot without creating another tab.
    if (tab?.entries[tab.index].startsWith('/watch/')) navigatorFor(activeId).push('/')
    void player.playVideo(videoId, 'video')
    window.dispatchEvent(new CustomEvent(MINI_PLAYER_OPEN_EVENT, { detail: { tabId: activeId } }))
  }, [players, activeId, tabs, navigatorFor, requestPlayback])

  useEffect(() => {
    if (players[activeId]?.videoId) setPreferredId(activeId)
  }, [activeId, players[activeId]?.videoId])

  useEffect(() => {
    const onState = (event: Event) => {
      const { tabId, paused } = (event as CustomEvent<PlayerStateDetail>).detail
      if (!tabId) return
      setPlayingIds((current) => {
        if (current.includes(tabId) === !paused) return current
        return paused ? current.filter((id) => id !== tabId) : [...current, tabId]
      })
    }
    window.addEventListener(PLAYER_STATE_EVENT, onState)
    return () => window.removeEventListener(PLAYER_STATE_EVENT, onState)
  }, [])

  const value = useMemo(() => ({ register, ownerId, playingIds, requestPlayback, shouldAutoplay, playInMiniPlayer }), [register, ownerId, playingIds, requestPlayback, shouldAutoplay, playInMiniPlayer])
  return <WorkspaceContext.Provider value={value}>
    <GlobalPlayerContext.Provider value={selected}>{children}</GlobalPlayerContext.Provider>
  </WorkspaceContext.Provider>
}

export function RegisterTabPlayer() {
  const player = useGlobalPlayer()
  const { register } = usePlayerWorkspace()
  useEffect(() => { register(player.ownerTabId, player) }, [register, player])
  useEffect(() => () => register(player.ownerTabId, null), [register, player.ownerTabId])
  return null
}
