import { useEffect, useState } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { t, useLocale, locale } from '../i18n/LocaleContext'
import { useProfiles } from '../profiles/ProfileContext'
import { PROFILE_DATA_CHANGED_EVENT } from '../profiles/events'
import type { VideoRating } from '../../../shared/ipc'

export function VideoRatingButtons({ videoId, initialRating = 'none', likeCountText, compact = false }: {
  videoId: string
  initialRating?: VideoRating
  likeCountText: string | null
  compact?: boolean
}) {
  useLocale()
  const { youtubeAccount } = useProfiles()
  const [rating, setRating] = useState<VideoRating>(initialRating)
  const [count, setCount] = useState(likeCountText)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRating(initialRating)
    setCount(likeCountText)
    setBusy(false)
    setError(null)
  }, [videoId, initialRating, likeCountText])

  async function choose(choice: 'like' | 'dislike') {
    if (!youtubeAccount.signedIn || busy) return
    const next: VideoRating = rating === choice ? 'none' : choice
    setBusy(true)
    setError(null)
    try {
      const response = await window.api.setVideoRating(videoId, next)
      if (!response.ok) throw new Error(response.error)
      setRating(response.data.rating)
      if (response.data.likeCount !== null) {
        setCount(new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(response.data.likeCount))
      }
      window.dispatchEvent(new CustomEvent(PROFILE_DATA_CHANGED_EVENT))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const disabled = !youtubeAccount.signedIn || busy
  const reason = !youtubeAccount.signedIn ? t('Sign in to YouTube to rate videos') : undefined
  const buttonClass = compact
    ? 'flex w-9 min-w-0 flex-col items-center justify-center gap-0.5 rounded bg-neutral-800 px-0.5 py-1.5 text-neutral-200 hover:bg-neutral-700 disabled:opacity-50'
    : 'inline-flex h-9 items-center gap-2 rounded bg-neutral-800 px-3 text-sm font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50'

  return <div className={compact ? 'relative flex flex-col gap-2' : 'relative inline-flex items-center gap-1'}>
    <button type="button" disabled={disabled} aria-pressed={rating === 'like'}
      aria-label={rating === 'like' ? t('Remove like') : t('Like')}
      title={reason ?? (rating === 'like' ? t('Remove like') : t('Like'))}
      onClick={() => void choose('like')}
      className={`${buttonClass} cursor-pointer ${rating === 'like' ? 'wt-accent-text' : ''}`}>
      <ThumbsUp aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} fill={rating === 'like' ? 'currentColor' : 'none'} />
      {count && <span className={compact ? 'max-w-full truncate text-[10px]' : 'text-xs tabular-nums'}>{count}</span>}
    </button>
    <button type="button" disabled={disabled} aria-pressed={rating === 'dislike'}
      aria-label={rating === 'dislike' ? t('Remove dislike') : t('Dislike')}
      title={reason ?? (rating === 'dislike' ? t('Remove dislike') : t('Dislike'))}
      onClick={() => void choose('dislike')}
      className={`${buttonClass} cursor-pointer ${rating === 'dislike' ? 'wt-accent-text' : ''}`}>
      <ThumbsDown aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} fill={rating === 'dislike' ? 'currentColor' : 'none'} />
    </button>
    {error && <p role="alert" className={compact
      ? 'absolute bottom-0 right-full z-30 mr-2 w-52 rounded bg-neutral-900 p-2 text-xs text-red-300 shadow-xl'
      : 'absolute left-0 top-full z-30 mt-1 w-64 rounded bg-neutral-900 p-2 text-xs text-red-300 shadow-xl'}>{error}</p>}
  </div>
}
