import type { VideoRating } from '../shared/ipc'

/** The old and new YouTube watch-page button renderers both expose these
 * flags through youtubei.js basic_info when signed in. */
export function ratingFromInfo(info: { basic_info?: { is_liked?: boolean; is_disliked?: boolean } }): VideoRating {
  return info.basic_info?.is_liked === true ? 'like' : info.basic_info?.is_disliked === true ? 'dislike' : 'none'
}
