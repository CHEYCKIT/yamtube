import { t, useLocale } from '../i18n/LocaleContext'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { VideoCard } from '../components/VideoCard'
import { PageLoader } from '../components/PageLoader'
import { ShortsScroller } from '../components/ShortsScroller'
import { useProfiles } from '../profiles/ProfileContext'
import type { HomeDiscovery, SearchResultItem } from '../../../shared/ipc'

type FeedStatus = 'loading' | 'ready' | 'error'

export function Home() {
  useLocale()
  const { activeProfileId, youtubeAccount } = useProfiles()
  const [feedStatus, setFeedStatus] = useState<FeedStatus>('loading')
  const [feed, setFeed] = useState<SearchResultItem[]>([])
  const [feedError, setFeedError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [discovery, setDiscovery] = useState<HomeDiscovery | null>(null)

  useEffect(() => {
    let cancelled = false
    setFeedStatus('loading')
    setFeedError(null)
    async function loadFeed() {
      try {
        const response = await window.api.getHomeFeed()
        if (cancelled) return
        if (!response.ok) throw new Error(response.error)
        setFeed(response.data)
        setDiscovery(response.home ?? null)
        setFeedStatus('ready')
      } catch (error) {
        if (cancelled) return
        setFeedError(error instanceof Error ? error.message : String(error))
        setFeedStatus('error')
      }
    }
    void loadFeed()
    return () => { cancelled = true }
  }, [attempt, activeProfileId])

  const videoTile = (video: SearchResultItem) => <VideoCard key={video.videoId} {...video} badge={video.durationText}
    meta={[video.viewCountText, video.publishedText].filter(Boolean).join(' · ')} />

  return (
    <section aria-label={t("Home")} aria-busy={feedStatus === 'loading'}>
      <h1 className="mb-4 text-xl font-semibold">{t("Home")}</h1>
      {!youtubeAccount.signedIn && <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded border border-neutral-800 bg-neutral-900/50 p-4">
        <p className="text-sm text-neutral-300">Connect YouTube for your recommendations, subscriptions and watch history.</p>
        <Link to="/account" className="wt-action-important rounded px-4 py-2 text-sm font-medium">Sign in to YouTube</Link>
      </div>}
      {youtubeAccount.syncError && <p role="status" className="mb-4 text-sm text-amber-300">{youtubeAccount.syncError}</p>}
      {feedStatus === 'loading' && <PageLoader />}
      {feedStatus === 'error' && <div role="alert" className="border-y border-neutral-800 py-6">
        <p className="mb-3 text-sm text-red-400">{feedError}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)} className="wt-action cursor-pointer rounded px-4 py-2 text-sm font-medium">{t('Retry')}</button>
      </div>}
      {feedStatus === 'ready' && feed.length === 0 && <p className="py-6 text-sm text-neutral-400">{t('No videos available')}</p>}
      {feedStatus === 'ready' && <div className="space-y-8">
        {feed[0] && <section>
          <h2 className="mb-3 text-lg font-semibold">{t('For you')}</h2>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,calc(50%+80px))_minmax(0,1fr)]">
            <div className="min-w-0"><VideoCard {...feed[0]} featured alignedFooter badge={feed[0].durationText}
              meta={[feed[0].viewCountText, feed[0].publishedText].filter(Boolean).join(' · ')} /></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{feed.slice(1, 5).map((video) => <VideoCard key={video.videoId} {...video} alignedFooter badge={video.durationText}
              meta={[video.viewCountText, video.publishedText].filter(Boolean).join(' · ')} />)}</div>
          </div>
        </section>}
        {feed.length > 5 && <section className="border-t border-neutral-800 pt-6">
          <h2 className="mb-3 text-lg font-semibold">{t('More to explore')}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{feed.slice(5).map(videoTile)}</div>
        </section>}
        {discovery && discovery.shorts.length > 0 && <section aria-label={t('Shorts')} className="border-t border-neutral-800 pt-6">
          <h2 className="mb-3 text-lg font-semibold">{t('Shorts')}</h2>
          <ShortsScroller kind="home" label={t('Recommended Shorts')}>
            {discovery.shorts.map((short) =>
              <div key={short.videoId} className="w-32 shrink-0 snap-start sm:w-36">
                <VideoCard {...short} portrait shorts={discovery.shorts} meta={short.viewCountText} />
              </div>
            )}
          </ShortsScroller>
        </section>}
      </div>}
    </section>
  )
}
