import type { SearchResultItem } from '../shared/ipc'

/** Keep the Home Shorts strip limited to confirmed Shorts renderers. A
 * regular video under 60 seconds is not necessarily a Short. */
type VideoEndpoint = { payload?: { reelWatchEndpoint?: { videoId?: string }; watchEndpoint?: { videoId?: string }; videoId?: string } }
type Thumbnail = { url?: string }
type TextValue = { toString(): string } | string | null | undefined
type ShortsNode = {
  type?: string
  id?: string
  title?: TextValue
  views?: TextValue
  thumbnails?: Thumbnail[]
  thumbnail?: Thumbnail[]
  accessibility_text?: string
  on_tap_endpoint?: VideoEndpoint
  overlay_metadata?: { primary_text?: TextValue; secondary_text?: TextValue }
}

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/

function label(value: TextValue): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

/** Search results can contain ReelItem and newer ShortsLockupView models. */
export function mapRecommendedShorts(nodes: readonly unknown[]): SearchResultItem[] {
  const seen = new Set<string>()
  const items: SearchResultItem[] = []
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const short = node as ShortsNode
    if (short.type !== 'ShortsLockupView' && short.type !== 'ReelItem') continue
    const payload = short.on_tap_endpoint?.payload
    const videoId = short.type === 'ReelItem' ? short.id :
      payload?.reelWatchEndpoint?.videoId ?? payload?.watchEndpoint?.videoId ?? payload?.videoId
    if (!videoId || !videoIdPattern.test(videoId) || seen.has(videoId)) continue
    const title = label(short.type === 'ReelItem' ? short.title : short.overlay_metadata?.primary_text)
      ?? label(short.accessibility_text) ?? 'Short'
    seen.add(videoId)
    items.push({
      videoId, title,
      channelId: null, channelName: '',
      thumbnailUrl: (short.type === 'ReelItem' ? short.thumbnails?.[0]?.url : short.thumbnail?.[0]?.url) ?? null,
      durationText: null,
      viewCountText: label(short.type === 'ReelItem' ? short.views : short.overlay_metadata?.secondary_text),
      publishedText: null
    })
  }
  return items
}

/** Take turns across independent topic searches, not one whole result batch
 * at a time. This avoids recent viewing of a single creator dominating Home. */
export function interleaveShorts(batches: SearchResultItem[][], limit = 24): SearchResultItem[] {
  const seen = new Set<string>()
  const result: SearchResultItem[] = []
  const maxLength = Math.max(0, ...batches.map((batch) => batch.length))
  for (let index = 0; index < maxLength && result.length < limit; index++) {
    for (const batch of batches) {
      const short = batch[index]
      if (!short || seen.has(short.videoId)) continue
      seen.add(short.videoId)
      result.push(short)
      if (result.length === limit) break
    }
  }
  return result
}

/** Enforce creator diversity using YouTube's verified channel IDs. */
export function selectDiverseShorts(candidates: SearchResultItem[], limit = 12, perCreator = 2): SearchResultItem[] {
  const seen = new Set<string>()
  const counts = new Map<string, number>()
  const result: SearchResultItem[] = []
  for (const short of candidates) {
    if (seen.has(short.videoId)) continue
    const creator = short.channelId || short.channelName.trim().toLowerCase()
    if (creator && (counts.get(creator) ?? 0) >= perCreator) continue
    seen.add(short.videoId)
    if (creator) counts.set(creator, (counts.get(creator) ?? 0) + 1)
    result.push(short)
    if (result.length === limit) break
  }
  return result
}

/** Search by video subject, never by the most recently watched creator. */
export function shortsTopicQuery(title: string): string | null {
  const words = title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/u)
    .filter((word) => word.length >= 3 && !['the', 'and', 'with', 'from', 'this', 'that', 'video', 'official',
      'watch', 'full', 'shorts', 'short', 'part', 'episode', 'you', 'for', 'live'].includes(word))
  return words.length ? words.slice(0, 3).join(' ') + ' shorts' : null
}
