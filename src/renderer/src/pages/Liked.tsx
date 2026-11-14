import { useState } from 'react'
import { Link } from 'react-router-dom'
import { t, useLocale } from '../i18n/LocaleContext'
import { VideoCard } from '../components/VideoCard'
import { PageLoader } from '../components/PageLoader'
import { useProfiles } from '../profiles/ProfileContext'
import { PROFILE_DATA_CHANGED_EVENT } from '../profiles/events'
import { useLibraryVideos } from '../library/useLibraryVideos'

/** YouTube's LL playlist is account-owned. No local imitation of likes. */
export function Liked() {
  useLocale()
  const { youtubeAccount } = useProfiles()
  const { videos, loading, error, continuation, loadMore, reload } = useLibraryVideos('LL', 'video', youtubeAccount.signedIn)
  const [removing, setRemoving] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function unlike(videoId: string) {
    if (removing) return
    setRemoving(videoId)
    setActionError(null)
    try {
      const response = await window.api.setVideoRating(videoId, 'none')
      if (!response.ok) throw new Error(response.error)
      window.dispatchEvent(new CustomEvent(PROFILE_DATA_CHANGED_EVENT))
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRemoving(null)
    }
  }

  if (!youtubeAccount.signedIn) return <section>
    <h1 className="mb-4 text-xl font-semibold">{t('Likes')}</h1>
    <p className="text-sm text-neutral-400">{t('Connect your YouTube account to see your liked videos.')}{' '}
      <Link to="/account" className="wt-link underline">{t('Account & privacy')}</Link>
    </p>
  </section>

  return <section>
    <h1 className="mb-4 text-xl font-semibold">{t('Likes')}</h1>
    {(error || actionError) && <p role="alert" className="mb-4 text-sm text-red-400">{error || actionError}{' '}
      <button type="button" className="underline" onClick={() => { setActionError(null); reload() }}>{t('Retry')}</button>
    </p>}
    {loading && !videos.length ? <PageLoader /> : videos.length === 0 && !error
      ? <p className="text-sm text-neutral-400">{t('No liked videos yet.')}</p>
      : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {videos.map((video) => <div key={video.id}>
          <VideoCard videoId={video.videoId} title={video.title} channelId={video.channelId}
            channelName={video.channelName} thumbnailUrl={video.thumbnailUrl} />
          <button type="button" disabled={removing !== null}
            onClick={() => void unlike(video.videoId)}
            className="mt-1 cursor-pointer rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-50">{t('Unlike')}</button>
        </div>)}
      </div>}
    {continuation && <button type="button" disabled={loading} onClick={() => void loadMore()} className="wt-action mt-4 rounded px-4 py-2">
      {loading ? t('Loading...') : t('Load more')}
    </button>}
  </section>
}
