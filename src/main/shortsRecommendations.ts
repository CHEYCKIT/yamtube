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
