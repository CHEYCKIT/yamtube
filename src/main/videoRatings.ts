import { accountRevision, getAccountClient, hasYoutubeAccount } from './youtubeAccount'
import type { VideoRating, VideoRatingResult } from '../shared/ipc'

export function ratingFromInfo(info: { basic_info?: { is_liked?: boolean; is_disliked?: boolean } }): VideoRating {
  return info.basic_info?.is_liked === true ? 'like' : info.basic_info?.is_disliked === true ? 'dislike' : 'none'
}

export async function setYoutubeVideoRating(videoId: string, target: VideoRating): Promise<VideoRatingResult> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !['like','dislike','none'].includes(target)) throw new Error('Invalid video rating request.')
  if (!hasYoutubeAccount()) throw new Error('Connect your YouTube account to like or dislike videos.')
  const revision = accountRevision()
  const client = await getAccountClient()
  const info = await client.getInfo(videoId)
  if (revision !== accountRevision() || !hasYoutubeAccount()) throw new Error('Your YouTube account changed. Retry the rating.')
  const previous = ratingFromInfo(info)
  if (previous !== target) {
    const response = target === 'like' ? await info.like() : target === 'dislike' ? await info.dislike() : await info.removeRating()
    if (!response.success) throw new Error('YouTube did not confirm this rating. Retry after checking your account.')
  }
  if (revision !== accountRevision() || !hasYoutubeAccount()) throw new Error('Your YouTube account changed. Reload the video.')
  // Count is YouTube's public total. Never synthesize an unavailable dislike total.
  const count = info.basic_info.like_count
  const updated = typeof count === 'number' && Number.isFinite(count)
    ? Math.max(0, count + Number(target === 'like') - Number(previous === 'like'))
    : null
  return { rating: target, likeCount: updated }
}
