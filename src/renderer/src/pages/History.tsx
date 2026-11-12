import { t, useLocale, locale } from '../i18n/LocaleContext'
import { useEffect, useState } from 'react'
import { VideoCard } from '../components/VideoCard'
import { Link } from 'react-router-dom'
import { PageLoader } from '../components/PageLoader'
import { useProfiles } from '../profiles/ProfileContext'
import type { HistoryEntry, SearchResultItem } from '../../../shared/ipc'

function formatWatchedAt(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs
  const diffMinutes = Math.round(diffMs / 60_000)
  if (diffMinutes < 1) return t("Recién")
  if (diffMinutes < 60) return t('Hace {count} min', { count: diffMinutes })
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return t('Hace {count} h', { count: diffHours })
  const diffDays = Math.round(diffHours / 24)
  if (diffDays < 30) return t('Hace {count} d', { count: diffDays })
  return new Date(timestampMs).toLocaleDateString(locale())
}

export function History() {
  useLocale()
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [remote, setRemote] = useState<SearchResultItem[]>([])
  const [continuation, setContinuation] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const { activeProfileId, youtubeAccount } = useProfiles()

  useEffect(() => {
    let cancelled = false
    setEntries(null)
    setError(null)
    if (youtubeAccount.signedIn) {
      window.api.getYoutubeHistory().then((page) => {
        if (cancelled) return
        setRemote(page.videos); setContinuation(page.continuation); setPaused(page.paused); setEntries([])
      }).catch(() => { if (!cancelled) { setError('YouTube history could not be loaded. Retry, or reconnect your account.'); setEntries([]) } })
      return () => { cancelled = true }
    }
    window.api.getHistory().then((items) => {
      if (!cancelled) setEntries(items)
    }).catch(() => { if (!cancelled) { setError('Local history could not be loaded.'); setEntries([]) } })
    return () => {
      cancelled = true
    }
  }, [activeProfileId, youtubeAccount.signedIn, attempt])

  async function handleClear() {
    try { await window.api.clearHistory(); setEntries([]) }
    catch { setError('Local history could not be cleared.') }
  }

  if (entries === null) return <PageLoader />

  if (youtubeAccount.signedIn) return <div>
    <h1 className="mb-2 text-xl font-semibold">YouTube watch history</h1>
    <p className="mb-5 text-sm text-neutral-400">From {youtubeAccount.name}’s YouTube account. Videos watched here are sent to YouTube after playback starts.</p>
    {paused && <p role="status" className="mb-4 text-sm text-amber-300">Your YouTube watch history is paused. Resume it in your YouTube account settings to save future watches.</p>}
    {youtubeAccount.syncError && <p role="alert" className="mb-4 text-sm text-amber-300">{youtubeAccount.syncError}</p>}
    {error && <div role="alert" className="mb-4 text-sm text-red-400"><p>{error}</p>
      <button className="mt-2 rounded bg-neutral-800 px-3 py-2 text-neutral-100" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
      <Link to="/account" className="ml-4 underline">Account settings</Link></div>}
    {!error && !remote.length && <p className="text-sm text-neutral-400">No videos in your YouTube watch history.</p>}
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {remote.map((video) => <VideoCard key={video.videoId} {...video} badge={video.durationText} />)}
    </div>
    {continuation && <button disabled={loadingMore} className="mt-6 rounded bg-neutral-800 px-4 py-2 text-sm disabled:opacity-50" onClick={async () => {
      setLoadingMore(true); setError(null)
      try {
        const page = await window.api.getMoreYoutubeHistory(continuation)
        setRemote((previous) => [...new Map([...previous, ...page.videos].map((video) => [video.videoId, video])).values()])
        setContinuation(page.continuation)
      } catch { setError('More history could not be loaded.') }
      finally { setLoadingMore(false) }
    }}>{loadingMore ? 'Loading…' : 'Load more'}</button>}
  </div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("Historial")}</h1>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
          >
            {t("Borrar historial")}</button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-neutral-400">{t("Todavía no viste ningún video.")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {entries.map((entry) => (
            <VideoCard
              key={entry.videoId}
              videoId={entry.videoId}
              title={entry.title}
              channelId={entry.channelId}
              channelName={entry.channelName}
              thumbnailUrl={entry.thumbnailUrl}
              meta={formatWatchedAt(entry.watchedAt)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
