import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAppTabs } from '../tabs/AppTabs'
import { GlobalPlayerContext, initialState, useGlobalPlayer, type GlobalPlayerContextValue } from './GlobalPlayerContext'
import { PLAYER_COMMAND_EVENT, PLAYER_STATE_EVENT, type PlayerCommandDetail, type PlayerStateDetail } from './events'
import { MINI_PLAYER_OPEN_EVENT } from './events'
import { musicArtworkCandidates } from '../components/MusicArtwork'

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


  const mediaOwnerId = (playingIds.includes(activeId) && available(activeId) ? activeId
    : [...playingIds].reverse().find((id) => available(id))) || ownerId
  const mediaPlayer = players[mediaOwnerId] || emptyPlayer

  // One playing tab publishes an OS media session. Each tab has its
  // own persistent <video>; publishing from individual tab players would leave
  // stale or competing Windows SMTC entries after switching tabs.
  useEffect(() => {
    const session = navigator.mediaSession
    if (!session) return
    const actions: MediaSessionAction[] = ['play', 'pause', 'stop', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto']
    const register = (action: MediaSessionAction, callback: MediaSessionActionHandler | null) => {
      try { session.setActionHandler(action, callback) } catch { /* Unsupported on this platform. */ }
    }
    if (!mediaOwnerId || !mediaPlayer.videoId || mediaPlayer.status !== 'ready') {
      session.metadata = null
      session.playbackState = 'none'
      for (const action of actions) register(action, null)
      return
    }

    const videoId = mediaPlayer.videoId
    const track = mediaPlayer.playbackMode === 'music' ? mediaPlayer.musicQueue.find((item) => item.videoId === videoId) : null
    const artwork = musicArtworkCandidates(videoId, track?.thumbnailUrl ?? mediaPlayer.thumbnailUrl)
      .slice(0, 4).map((src) => ({ src }))
    if (typeof MediaMetadata !== 'undefined') {
      session.metadata = new MediaMetadata({
        title: mediaPlayer.title || track?.title || 'LokTube',
        artist: mediaPlayer.channelName || track?.channelName || '',
        album: mediaPlayer.playbackMode === 'music' ? 'LokTube Music' : 'LokTube',
        artwork
      })
    }
    session.playbackState = playingIds.includes(mediaOwnerId) ? 'playing' : 'paused'
    const send = (detail: PlayerCommandDetail) => window.dispatchEvent(new CustomEvent<PlayerCommandDetail>(PLAYER_COMMAND_EVENT, { detail: { ...detail, tabId: mediaOwnerId } }))
    const queue = mediaPlayer.playbackMode === 'music' ? mediaPlayer.musicQueue : mediaPlayer.videoQueue
    const currentIndex = queue.findIndex((item) => item.videoId === videoId)
    const playAt = (index: number) => {
      const item = queue[index]
      if (!item) return
      requestPlayback(mediaOwnerId)
      if (mediaPlayer.playbackMode === 'music') void mediaPlayer.playMusic(item.videoId, mediaPlayer.musicQueue, mediaPlayer.musicSourcePath ?? undefined)
      else void mediaPlayer.playVideoQueue(item.videoId, mediaPlayer.videoQueue)
    }
    register('play', () => send({ action: 'play' }))
    register('pause', () => send({ action: 'pause' }))
    register('stop', () => { send({ action: 'pause' }); mediaPlayer.closePlayer() })
    register('previoustrack', currentIndex > 0 ? () => playAt(currentIndex - 1) : null)
    register('nexttrack', currentIndex >= 0 && currentIndex < queue.length - 1 ? () => playAt(currentIndex + 1) : null)
    register('seekbackward', (details) => send({ action: 'seek-relative', seconds: -(details.seekOffset ?? 10) }))
    register('seekforward', (details) => send({ action: 'seek-relative', seconds: details.seekOffset ?? 10 }))
    register('seekto', (details) => {
      if (typeof details.seekTime === 'number' && Number.isFinite(details.seekTime)) send({ action: 'seek-to', seconds: details.seekTime })
    })

    const updatePosition = (event: Event) => {
      const detail = (event as CustomEvent<PlayerStateDetail>).detail
      if (detail.tabId !== mediaOwnerId || detail.videoId !== videoId) return
      session.playbackState = detail.paused ? 'paused' : 'playing'
      if (detail.duration > 0 && Number.isFinite(detail.duration)) {
        try {
          session.setPositionState({
            duration: detail.duration,
            playbackRate: 1,
            position: Math.min(detail.duration, Math.max(0, detail.currentTime || 0))
          })
        } catch { /* Some platforms do not expose the media timeline. */ }
      }
    }
    window.addEventListener(PLAYER_STATE_EVENT, updatePosition)
    send({ action: 'sync' })
    return () => {
      window.removeEventListener(PLAYER_STATE_EVENT, updatePosition)
      for (const action of actions) register(action, null)
    }
  }, [mediaOwnerId, mediaPlayer, playingIds, requestPlayback])

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
