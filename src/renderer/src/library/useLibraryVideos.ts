import { useEffect, useRef, useState } from 'react'
import { useProfiles } from '../profiles/ProfileContext'
import { PROFILE_DATA_CHANGED_EVENT } from '../profiles/events'
import type { LibraryKind, SavedVideo } from '../../../shared/ipc'

export function useLibraryVideos(playlistId: string | null, library: LibraryKind = 'video', enabled = true) {
  const { activeProfileId, youtubeAccount } = useProfiles()
  const [videos, setVideos] = useState<SavedVideo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [continuation, setContinuation] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  const pending = useRef(false)
  const reload = () => setRevision((value) => value + 1)
  useEffect(() => {
    const owner = ++generation.current
    setVideos([]); setContinuation(null); setError(null)
    pending.current = false
    setLoading(enabled)
    if (!enabled) return
    void window.api.getLibraryVideos(playlistId, library).then((page) => {
      if (owner !== generation.current) return
      setVideos(page.videos); setContinuation(page.continuation)
    }).catch((cause) => {
      if (owner === generation.current) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { if (owner === generation.current) setLoading(false) })
    return () => { generation.current++ }
  }, [playlistId, library, enabled, activeProfileId, youtubeAccount.signedIn, youtubeAccount.name, revision])
  useEffect(() => {
    window.addEventListener(PROFILE_DATA_CHANGED_EVENT, reload)
    return () => window.removeEventListener(PROFILE_DATA_CHANGED_EVENT, reload)
  }, [])
  const loadMore = async () => {
    if (!continuation || loading || pending.current) return
    const owner = generation.current
    pending.current = true; setLoading(true); setError(null)
    try {
      const page = await window.api.getLibraryVideos(playlistId, library, continuation)
      if (owner !== generation.current) return
      setVideos((items) => [...items, ...page.videos]); setContinuation(page.continuation)
    } catch (cause) { if (owner === generation.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (owner === generation.current) { pending.current = false; setLoading(false) } }
  }
  return { videos, loading, error, continuation, loadMore, reload }
}
