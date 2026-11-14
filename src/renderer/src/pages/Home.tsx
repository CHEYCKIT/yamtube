import { t, useLocale } from '../i18n/LocaleContext'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { VideoCard } from '../components/VideoCard'
import { PageLoader } from '../components/PageLoader'
import { ShortsScroller } from '../components/ShortsScroller'
import { useProfiles } from '../profiles/ProfileContext'
import type { HomeDiscovery, SearchResultItem } from '../../../shared/ipc'

type FeedStatus = 'loading' | 'ready' | 'error'

export function Home() {
  const { showHomeTopics } = useLocale()
  const { activeProfileId, youtubeAccount } = useProfiles()
  const [feedStatus, setFeedStatus] = useState<FeedStatus>('loading')
  const [feed, setFeed] = useState<SearchResultItem[]>([])
  const [feedError, setFeedError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [discovery, setDiscovery] = useState<HomeDiscovery | null>(null)
  const [topics, setTopics] = useState<string[]>([])
  const [selectedTopic, setSelectedTopic] = useState('')
  const [topicLoading, setTopicLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const [topicError, setTopicError] = useState<string | null>(null)
  const rootSessionRef = useRef<string | null>(null)
  // Prevent stale topic/continuation replies from overwriting a newer choice.
  const generationRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const generation = ++generationRef.current
    setFeedStatus('loading')
    setFeedError(null)
    setFeed([])
    setTopics([])
    setSelectedTopic('')
    setSessionId(null)
    setHasMore(false)
    setDiscovery(null)
    rootSessionRef.current = null
    setTopicLoading(false)
    setLoadingMore(false)
    setTopicError(null)
    setMoreError(null)
    async function loadFeed() {
      try {
        const response = await window.api.getHomeFeed()
        if (cancelled || generation !== generationRef.current) return
        if (!response.ok) throw new Error(response.error)
        setFeed(response.data)
        setDiscovery(response.home ?? null)
        setTopics(response.home?.topics ?? [])
        rootSessionRef.current = response.home?.sessionId ?? null
        setSessionId(response.home?.sessionId ?? null)
        setHasMore(response.home?.hasMore === true)
        setFeedStatus('ready')
      } catch (error) {
        if (cancelled || generation !== generationRef.current) return
        setFeedError(error instanceof Error ? error.message : String(error))
        setFeedStatus('error')
      }
    }
    void loadFeed()
    return () => { cancelled = true; ++generationRef.current }
  }, [attempt, activeProfileId, youtubeAccount.signedIn, youtubeAccount.name])

  async function chooseTopic(topic: string) {
    if (topic === selectedTopic || !rootSessionRef.current) return
    const root = rootSessionRef.current
    if (!root) return
    const generation = ++generationRef.current
    const previousTopic = selectedTopic
    setSelectedTopic(topic)
    setTopicLoading(true)
    setTopicError(null)
    setMoreError(null)
    setLoadingMore(false)
    try {
      const response = await window.api.getHomeTopic(root, topic)
      if (generation !== generationRef.current) return
      if (!response.ok) throw new Error(response.error)
      setFeed(response.data)
      setSessionId(response.home?.sessionId ?? null)
      setHasMore(response.home?.hasMore === true)
      // Shorts are a separate shelf; switching the regular Home topic must
      // not refetch or clear them.
    } catch (error) {
      if (generation === generationRef.current) {
        setSelectedTopic(previousTopic)
        setTopicError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (generation === generationRef.current) setTopicLoading(false)
    }
  }

  async function showMore() {
    if (!sessionId || loadingMore || topicLoading || !hasMore) return
    const generation = generationRef.current
    const expectedSession = sessionId
    setLoadingMore(true)
    setMoreError(null)
    try {
      const response = await window.api.getHomeMore(expectedSession)
      if (generation !== generationRef.current) return
      if (!response.ok) throw new Error(response.error)
      setFeed((current) => {
        const seen = new Set(current.map(video => video.videoId))
        return [...current, ...response.data.filter(video => {
          if (seen.has(video.videoId)) return false
          seen.add(video.videoId)
          return true
        })]
      })
      setHasMore(response.home?.hasMore === true)
    } catch (error) {
      if (generation === generationRef.current)
        setMoreError(error instanceof Error ? error.message : String(error))
    } finally {
      if (generation === generationRef.current) setLoadingMore(false)
    }
  }

  const videoTile = (video: SearchResultItem) =>
    <VideoCard key={video.videoId} {...video} alignedFooter badge={video.durationText}
      meta={[video.viewCountText, video.publishedText].filter(Boolean).join(' · ')} />
  const topicItems = topics.filter((topic) => topic.trim() &&
    !['all', 'todo'].includes(topic.trim().toLowerCase()))

  return (
    <section aria-label={t('Home')} aria-busy={feedStatus === 'loading'}>
      <div className="mb-4 flex min-w-0 items-center gap-4">
        <h1 className="shrink-0 text-xl font-semibold">{t('Home')}</h1>
        {showHomeTopics && youtubeAccount.signedIn && topicItems.length > 0 && (
          <div data-home-topics aria-label={t('Home topics')}
            className="wt-home-topics flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overscroll-x-contain whitespace-nowrap">
            {[{ value: '', label: t('All') }, ...topicItems.map(topic => ({ value: topic, label: topic }))].map(item =>
              <button key={item.value} type="button" aria-pressed={selectedTopic === item.value}
                disabled={!rootSessionRef.current}
                onClick={() => void chooseTopic(item.value)}
                className={`shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-sm transition-colors disabled:cursor-default
                  ${selectedTopic === item.value ? 'bg-white font-semibold text-neutral-950' :
                    'bg-neutral-800 text-neutral-100 hover:bg-neutral-700'}`}>
                {item.label}
              </button>)}
          </div>
        )}
      </div>
      {!youtubeAccount.signedIn && <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded border border-neutral-800 bg-neutral-900/50 p-4">
        <p className="text-sm text-neutral-300">Connect YouTube for your recommendations, subscriptions and watch history.</p>
        <Link to="/account" className="wt-action-important rounded px-4 py-2 text-sm font-medium">Sign in to YouTube</Link>
      </div>}
      {youtubeAccount.syncError && <p role="status" className="mb-4 text-sm text-amber-300">{youtubeAccount.syncError}</p>}
      {feedStatus === 'loading' && <PageLoader />}
      {feedStatus === 'error' && <div role="alert" className="border-y border-neutral-800 py-6">
        <p className="mb-3 text-sm text-red-400">{feedError}</p>
        <button type="button" onClick={() => setAttempt(value => value + 1)}
          className="wt-action cursor-pointer rounded px-4 py-2 text-sm font-medium">{t('Retry')}</button>
      </div>}
      {feedStatus === 'ready' && <div className="space-y-8">
        <section aria-label={t('For you')}>
          <h2 className="mb-3 text-lg font-semibold">{t('For you')}</h2>
          {topicError && <p role="alert" className="mb-3 text-sm text-red-400">{topicError}</p>}
          {topicLoading && <p role="status" className="mb-3 text-sm text-neutral-400">{t('Loading recommendations...')}</p>}
          {feed.length === 0 && !topicLoading &&
            <p className="py-6 text-sm text-neutral-400">{t('No videos available')}</p>}
          <div data-home-first-row className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {feed.slice(0, 3).map(videoTile)}
          </div>
          {feed.length > 3 && <div data-home-video-grid
            className="mt-4 grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {feed.slice(3).map(videoTile)}
          </div>}
          {hasMore && <div className="mt-6 flex justify-center">
            <button type="button" disabled={loadingMore || topicLoading}
              aria-label={t('Show more')} onClick={() => void showMore()}
              className="wt-action min-w-36 cursor-pointer rounded-full border border-neutral-700 px-5 py-2 text-sm font-semibold hover:bg-neutral-800 disabled:cursor-default disabled:opacity-60">
              {loadingMore ? t('Loading...') : t('Show more')}
            </button>
          </div>}
          {moreError && <p role="alert" className="mt-3 text-center text-sm text-red-400">
            {t('Could not load more recommendations')}: {moreError}
          </p>}
        </section>
        {discovery && discovery.shorts.length > 0 && <section aria-label={t('Shorts')} className="border-t border-neutral-800 pt-6">
          <h2 className="mb-3 text-lg font-semibold">{t('Shorts')}</h2>
          <ShortsScroller kind="home" label={t('Recommended Shorts')}>
            {discovery.shorts.map(short =>
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
