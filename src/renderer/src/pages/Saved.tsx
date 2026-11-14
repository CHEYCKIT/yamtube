import { t, useLocale, locale } from '../i18n/LocaleContext'
import { VideoCard } from '../components/VideoCard'
import { PageLoader } from '../components/PageLoader'
import { useProfiles } from '../profiles/ProfileContext'
import { PROFILE_DATA_CHANGED_EVENT } from '../profiles/events'
import { useLibraryVideos } from '../library/useLibraryVideos'
import { useState } from 'react'
import type { SavedVideo } from '../../../shared/ipc'

function formatSavedAt(timestampMs: number): string {
  if (!timestampMs) return t("Saved")
  return t("Saved {date}", { date: new Date(timestampMs).toLocaleDateString(locale()) })
}

export function Saved() {
  useLocale()
  const { youtubeAccount } = useProfiles()
  const { videos, loading, error, continuation, loadMore, reload } = useLibraryVideos(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  async function remove(video: SavedVideo) {
    if (removing) return
    setRemoving(video.id); setRemoveError(null)
    try {
      await window.api.removeSavedVideo(video.videoId, null, 'video')
      window.dispatchEvent(new CustomEvent(PROFILE_DATA_CHANGED_EVENT))
    } catch (cause) { setRemoveError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setRemoving(null) }
  }
  if (loading && !videos.length) return <PageLoader />

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{youtubeAccount.signedIn ? t("Watch Later") : t("Saved")}</h1>
      {(error || removeError) && <p role="alert" className="mb-4 text-sm text-red-400">{error || removeError} <button onClick={reload} className="underline">{t("Retry")}</button></p>}
      {videos.length === 0 ? (
        <p className="text-sm text-neutral-400">{t("No saved videos.")}</p>
      ) : (
        <div className="wt-fluid-video-grid grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {videos.map((video) => (
            <div key={video.id}><VideoCard
              videoId={video.videoId}
              title={video.title}
              channelId={video.channelId}
              channelName={video.channelName}
              thumbnailUrl={video.thumbnailUrl}
              meta={formatSavedAt(video.savedAt)}
            />
            <button disabled={!!removing || video.canRemove === false} onClick={() => void remove(video)} className="mt-2 rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 disabled:opacity-50">{youtubeAccount.signedIn ? t("Remove from Watch Later") : t("Remove")}</button></div>
          ))}
        </div>
      )}
      {continuation && <button disabled={loading} onClick={() => void loadMore()} className="wt-action mt-4 rounded px-4 py-2">{loading ? t("Loading...") : t("Load more")}</button>}
    </div>
  )
}
