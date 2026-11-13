import { t, useLocale } from '../i18n/LocaleContext'
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ChannelAvatar } from '../components/ChannelAvatar'
import { VideoCard } from '../components/VideoCard'
import { PageLoader } from '../components/PageLoader'
import { useProfiles } from '../profiles/ProfileContext'
import type { SearchResultItem, Subscription } from '../../../shared/ipc'

type FeedStatus = 'loading' | 'ready' | 'error'

export function Subscriptions() {
  const preferences = useLocale()
  const subscriptionsExpanded = preferences.subscriptionsExpanded === true
  const [subs, setSubs] = useState<Subscription[] | null>(null)
  const [feedStatus, setFeedStatus] = useState<FeedStatus>('loading')
  const [feed, setFeed] = useState<SearchResultItem[]>([])
  const [feedError, setFeedError] = useState<string | null>(null)
  const [subsError, setSubsError] = useState<string | null>(null)
  const { activeProfileId } = useProfiles()

  useEffect(() => {
    let cancelled = false
    setSubs(null)
    setFeed([])
    setFeedStatus('loading')
    setFeedError(null)
    setSubsError(null)

    window.api.listSubscriptions().then((items) => {
      if (!cancelled) setSubs(items)
    }).catch(() => { if (!cancelled) { setSubs([]); setSubsError('Your subscriptions could not be loaded. Check your connection or reconnect your YouTube account.') } })
    window.api.getSubscriptionsFeed().then((response) => {
      if (cancelled) return
      if (response.ok) {
        setFeed(response.data)
        setFeedStatus('ready')
      } else {
        setFeedError(response.error)
        setFeedStatus('error')
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeProfileId])

  if (subs === null) return <PageLoader />
  if (subsError) return <p role="alert" className="text-sm text-red-400">{subsError}</p>

  if (subs.length === 0 && feedStatus === 'ready' && feed.length === 0) {
    return (
      <div>
        <h1 className="mb-4 text-xl font-semibold">{t("Subscriptions")}</h1>
        <p className="text-sm text-neutral-400">
          {t("You are not subscribed to any channels.")}</p>
      </div>
    )
  }

  return (
    <div>
      {subs.length > 0 && <section className="mb-5" aria-label={t('Subscribed channels')}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-300">{t('Subscribed channels')} ({subs.length})</h2>
          <button type="button" aria-expanded={subscriptionsExpanded} aria-controls="subscriptions-channels"
            onClick={() => void preferences.savePreferences({ ...preferences, subscriptionsExpanded: !subscriptionsExpanded })}
            className="flex h-9 items-center gap-1 rounded px-2 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-white">
            {subscriptionsExpanded ? <ChevronUp aria-hidden="true" className="h-4 w-4" /> : <ChevronDown aria-hidden="true" className="h-4 w-4" />}
            {t(subscriptionsExpanded ? 'Collapse channels' : 'Expand channels')}
          </button>
        </div>
        <div id="subscriptions-channels" data-subscriptions-layout={subscriptionsExpanded ? 'expanded' : 'strip'}
          className={subscriptionsExpanded ? 'flex flex-wrap gap-3' : 'flex gap-2 overflow-x-auto pb-2'}>
          {subs.map((sub) => (
            <Link key={sub.channelId} to={`/channel/${sub.channelId}`} title={sub.channelName}
              aria-label={sub.channelName}
              className={subscriptionsExpanded
                ? 'flex max-w-full items-center gap-2 rounded-full py-1 pl-1 pr-3 hover:bg-neutral-900'
                : 'flex max-w-48 shrink-0 items-center gap-2 rounded-full bg-neutral-900/70 py-1 pl-1 pr-3 hover:bg-neutral-800'}>
              <ChannelAvatar name={sub.channelName} thumbnailUrl={sub.thumbnailUrl} />
              <span className="max-w-40 truncate text-sm font-medium">{sub.channelName}</span>
            </Link>
          ))}
        </div>
      </section>

      {feedStatus === 'loading' && <PageLoader />}
      {feedStatus === 'error' && <p className="text-sm text-red-400">{feedError}</p>}
      {feedStatus === 'ready' && feed.length === 0 && (
        <p className="text-sm text-neutral-400">{t("No videos are available from your subscribed channels.")}</p>
      )}
      {feedStatus === 'ready' && feed.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {feed.map((video) => (
            <VideoCard
              key={video.videoId}
              videoId={video.videoId}
              title={video.title}
              channelId={video.channelId}
              channelName={video.channelName}
              thumbnailUrl={video.thumbnailUrl}
              previewUrl={video.previewUrl}
              badge={video.durationText}
              meta={[video.viewCountText, video.publishedText].filter(Boolean).join(' · ')}
            />
          ))}
        </div>
      )}
    </div>
  )
}
