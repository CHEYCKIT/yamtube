import { t, useLocale, locale } from '../i18n/LocaleContext'
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { VideoCard } from '../components/VideoCard'
import { Link } from 'react-router-dom'
import { PageLoader } from '../components/PageLoader'
import { useProfiles } from '../profiles/ProfileContext'
import type { HistoryEntry, SearchResultItem, YoutubeHistoryVideo } from '../../../shared/ipc'

const HISTORY_REMOVED_EVENT = 'loktube:history-removed'
function formatWatchedAt(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs
  const diffMinutes = Math.round(diffMs / 60_000)
  if (diffMinutes < 1) return t('Just now')
  if (diffMinutes < 60) return t('{count} min ago', { count: diffMinutes })
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return t('{count} hr ago', { count: diffHours })
  const diffDays = Math.round(diffHours / 24)
  if (diffDays < 30) return t('{count} days ago', { count: diffDays })
  return new Date(timestampMs).toLocaleDateString(locale())
}

function HistoryCard({ video, busy, canRemove, remote, meta, onRemove, portrait = false }: {
  video: SearchResultItem | HistoryEntry; busy: boolean; canRemove: boolean; remote: boolean; meta?: string; portrait?: boolean; onRemove(): void
}) {
  return <article data-history-video-id={video.videoId}>
    <VideoCard {...video} portrait={portrait} badge={'durationText' in video ? video.durationText : null} meta={meta} />
    <div className="flex justify-end px-1">
      <button type="button" disabled={busy || !canRemove} onClick={onRemove}
        aria-label={t('Remove "{title}" from history', { title: video.title })}
        title={!canRemove ? t('YouTube did not provide a removal action. Refresh history or remove this video on YouTube.') : t(remote ? 'Remove from YouTube watch history' : 'Remove from local history')}
        className="inline-flex min-h-8 items-center gap-1.5 rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-default disabled:opacity-50">
        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />{t(busy ? 'Removing…' : 'Remove')}
      </button>
    </div>
  </article>
}

export function History() {
  useLocale()
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [remote, setRemote] = useState<YoutubeHistoryVideo[]>([])
  const [continuation, setContinuation] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [deleting, setDeleting] = useState(new Set<string>())
  const [attempt, setAttempt] = useState(0)
  const { activeProfileId, youtubeAccount } = useProfiles()
  const profile = useRef(activeProfileId)
  profile.current = activeProfileId
  const removed = useRef(new Set<string>())
  const shortsStrip = useRef<HTMLDivElement>(null)
  const shorts = remote.filter((video) => video.isShort)
  const videos = remote.filter((video) => !video.isShort)

  useEffect(() => {
    let cancelled = false
    setEntries(null); setRemote([]); setContinuation(null); setPaused(false)
    setError(null); setMessage(null); setDeleting(new Set()); removed.current.clear()
    if (youtubeAccount.signedIn) {
      window.api.getYoutubeHistory().then((page) => {
        if (cancelled) return
        setRemote(page.videos.filter((video) => !removed.current.has(video.videoId)))
        setContinuation(page.continuation); setPaused(page.paused); setEntries([])
      }).catch(() => { if (!cancelled) { setError('YouTube history could not be loaded. Retry, or reconnect your account.'); setEntries([]) } })
    } else {
      window.api.getHistory().then((items) => {
        if (!cancelled) setEntries(items.filter((entry) => !removed.current.has(entry.videoId)))
      }).catch(() => { if (!cancelled) { setError('Local history could not be loaded.'); setEntries([]) } })
    }
    return () => { cancelled = true }
  }, [activeProfileId, youtubeAccount.signedIn, attempt])

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ profileId: string; videoId: string }>).detail
      if (detail.profileId !== activeProfileId) return
      removed.current.add(detail.videoId)
      setRemote((items) => items.filter((video) => video.videoId !== detail.videoId))
      setEntries((items) => items?.filter((entry) => entry.videoId !== detail.videoId) ?? null)
    }
    window.addEventListener(HISTORY_REMOVED_EVENT, update)
    return () => window.removeEventListener(HISTORY_REMOVED_EVENT, update)
  }, [activeProfileId])

  async function remove(video: HistoryEntry | YoutubeHistoryVideo) {
    const requestedProfile = activeProfileId
    if (!requestedProfile || deleting.has(video.videoId)) return
    setDeleting((current) => new Set(current).add(video.videoId)); setError(null); setMessage(null)
    try {
      if ('historyId' in video) await window.api.removeYoutubeHistoryVideo(video.historyId)
      else await window.api.removeLocalHistoryVideo(video.videoId, requestedProfile)
      if (profile.current !== requestedProfile) return
      window.dispatchEvent(new CustomEvent(HISTORY_REMOVED_EVENT, { detail: { profileId: requestedProfile, videoId: video.videoId } }))
      setMessage('historyId' in video ? 'Removed from YouTube watch history.' : 'Removed from local history.')
    } catch (failure) {
      if (profile.current === requestedProfile) setError(failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'History could not be updated. Try again.')
    } finally {
      if (profile.current === requestedProfile) setDeleting((current) => { const next = new Set(current); next.delete(video.videoId); return next })
    }
  }

  async function handleClear() {
    try { await window.api.clearHistory(); setEntries([]) }
    catch { setError('Local history could not be cleared.') }
  }

  if (entries === null) return <PageLoader />
  return <div>
    <div className="mb-2 flex items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">{t(youtubeAccount.signedIn ? 'YouTube watch history' : 'History')}</h1>
      {!youtubeAccount.signedIn && !!entries.length && <button type="button" disabled={!!deleting.size} onClick={() => void handleClear()}
        className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100 disabled:opacity-50">{t('Clear history')}</button>}
    </div>
    {youtubeAccount.signedIn && <p className="mb-5 text-sm text-neutral-400">{t('From {name}’s YouTube account. Removing a video here also removes it from YouTube watch history.', { name: youtubeAccount.name ?? '' })}</p>}
    {paused && <p role="status" className="mb-4 text-sm text-amber-300">{t('Your YouTube watch history is paused. Resume it in your YouTube account settings to save future watches.')}</p>}
    {youtubeAccount.syncError && <p role="alert" className="mb-4 text-sm text-amber-300">{youtubeAccount.syncError}</p>}
    {error && <div role="alert" className="mb-4 text-sm text-red-400"><p>{t(error)}</p>
      <button className="mt-2 rounded bg-neutral-800 px-3 py-2 text-neutral-100" onClick={() => setAttempt((value) => value + 1)}>{t('Retry')}</button>
      {youtubeAccount.signedIn && <Link to="/account" className="ml-4 underline">{t('Account settings')}</Link>}</div>}
    {message && <p role="status" className="mb-3 text-sm text-emerald-400">{t(message)}</p>}
    {!error && !(youtubeAccount.signedIn ? remote : entries).length && <p className="text-sm text-neutral-400">{t(youtubeAccount.signedIn ? 'No videos in your YouTube watch history.' : 'You have not watched any videos yet.')}</p>}
    {youtubeAccount.signedIn && shorts.length > 0 && <section aria-label={t('Shorts history')} className="mb-7 border-b border-neutral-800 pb-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('Shorts history')}</h2>
        <div className="flex gap-1">
          <button type="button" aria-label={t('Previous Shorts')} onClick={() => shortsStrip.current?.scrollBy({ left: -360, behavior: 'smooth' })} className="grid h-9 w-9 place-items-center rounded hover:bg-neutral-800"><ChevronLeft aria-hidden="true" className="h-5 w-5" /></button>
          <button type="button" aria-label={t('Next Shorts')} onClick={() => shortsStrip.current?.scrollBy({ left: 360, behavior: 'smooth' })} className="grid h-9 w-9 place-items-center rounded hover:bg-neutral-800"><ChevronRight aria-hidden="true" className="h-5 w-5" /></button>
        </div>
      </div>
      <div ref={shortsStrip} tabIndex={0} aria-label={t('Watched Shorts')} className="flex snap-x gap-3 overflow-x-auto pb-2">
        {shorts.map((video) => <div key={video.historyId} className="w-40 shrink-0 snap-start sm:w-44"><HistoryCard video={video} portrait remote canRemove={video.canRemove} busy={deleting.has(video.videoId)} onRemove={() => void remove(video)} /></div>)}
      </div>
    </section>}
    {youtubeAccount.signedIn && shorts.length > 0 && videos.length > 0 && <h2 className="mb-3 text-lg font-semibold">{t('Videos')}</h2>}
    <div data-history-videos className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {youtubeAccount.signedIn ? videos.map((video) => <HistoryCard key={video.historyId} video={video} remote canRemove={video.canRemove} busy={deleting.has(video.videoId)} onRemove={() => void remove(video)} />)
        : entries.map((entry) => <HistoryCard key={entry.videoId} video={entry} remote={false} canRemove busy={deleting.has(entry.videoId)} meta={formatWatchedAt(entry.watchedAt)} onRemove={() => void remove(entry)} />)}
    </div>
    {youtubeAccount.signedIn && continuation && <button disabled={loadingMore} className="mt-6 rounded bg-neutral-800 px-4 py-2 text-sm disabled:opacity-50" onClick={async () => {
      const requestedProfile = activeProfileId
      setLoadingMore(true); setError(null)
      try {
        const page = await window.api.getMoreYoutubeHistory(continuation)
        if (profile.current !== requestedProfile) return
        setRemote((previous) => {
          const seen = new Set(previous.map((video) => video.videoId))
          return [...previous, ...page.videos.filter((video) => {
            if (seen.has(video.videoId) || removed.current.has(video.videoId)) return false
            seen.add(video.videoId); return true
          })]
        })
        setContinuation(page.continuation)
      } catch { if (profile.current === requestedProfile) setError('More history could not be loaded.') }
      finally { if (profile.current === requestedProfile) setLoadingMore(false) }
    }}>{t(loadingMore ? 'Loading…' : 'Load more')}</button>}
  </div>
}
