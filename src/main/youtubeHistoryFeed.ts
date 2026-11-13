import type { SearchResultItem } from '../shared/ipc'

type Data = Record<string, unknown>
const object = (value: unknown): Data | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : null
function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  const data = object(value)
  if (!data) return ''
  if (typeof data.simpleText === 'string') return data.simpleText.trim()
  if (typeof data.content === 'string') return data.content.trim()
  return Array.isArray(data.runs) ? data.runs.map((run) => object(run)?.text ?? '').join('').trim() : ''
}
function find(value: unknown, key: string, depth = 0): unknown {
  if (depth > 18 || !value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const child of value) { const match = find(child, key, depth + 1); if (match !== undefined) return match }
  } else {
    const data = value as Data
    if (data[key] !== undefined) return data[key]
    for (const child of Object.values(data)) { const match = find(child, key, depth + 1); if (match !== undefined) return match }
  }
  return undefined
}
function removalToken(menu: unknown, depth = 0): string | null {
  if (depth > 22 || !menu || typeof menu !== 'object') return null
  if (Array.isArray(menu)) {
    for (const item of menu) { const token = removalToken(item, depth + 1); if (token) return token }
    return null
  }
  const data = menu as Data
  const labels = [data.text, data.title, data.tooltip, data.accessibilityText].map(text)
  const icon = object(data.icon)?.iconType
  const removesHistory = labels.some((label) => /remove from (?:watch )?history|(?:quitar|eliminar) del historial(?: de reproducci[oó]n(?:es)?)?/i.test(label)) || ['CLOSE', 'HISTORY_REMOVE', 'REMOVE_FROM_HISTORY'].includes(String(icon))
  if (removesHistory) {
    const feedback = object(find(data, 'feedbackEndpoint'))
    if (typeof feedback?.feedbackToken === 'string' && feedback.feedbackToken) return feedback.feedbackToken
  }
  for (const value of Object.values(data)) { const token = removalToken(value, depth + 1); if (token) return token }
  return null
}

export interface HistoryFeedItem { video: SearchResultItem; feedbackToken: string | null; isShort: boolean }
export interface HistoryFeed { items: HistoryFeedItem[]; continuation: string | null; paused: boolean }

function videoItem(kind: string, value: unknown): HistoryFeedItem | null {
  const data = object(value)
  if (!data) return null
  if (kind === 'lockupViewModel' && !['LOCKUP_CONTENT_TYPE_VIDEO', 'LOCKUP_CONTENT_TYPE_SHORT', 'LOCKUP_CONTENT_TYPE_MOVIE'].includes(String(data.contentType))) return null
  const id = data.videoId ?? data.contentId ?? find(data.onTap, 'videoId')
  if (typeof id !== 'string' || !/^[\w-]{11}$/.test(id)) return null
  const metadata = object(object(data.metadata)?.lockupMetadataViewModel)
  const overlay = object(data.overlayMetadata)
  const title = text(data.title ?? data.headline ?? metadata?.title ?? overlay?.primaryText) || (kind === 'shortsLockupViewModel' ? text(data.accessibilityText) : '')
  if (!title) return null
  const author = data.ownerText ?? data.shortBylineText ?? data.longBylineText
  const contentMetadata = object(object(metadata?.metadata)?.contentMetadataViewModel) ?? object(metadata?.metadata)
  const rows = contentMetadata?.metadataRows
  const parts = Array.isArray(rows) ? rows.flatMap((row) => {
    const values = object(row)?.metadataParts
    return Array.isArray(values) ? values : []
  }) : []
  const creator = parts.find((part) => String(find(part, 'browseId') ?? '').startsWith('UC'))
  const channelId = find(author ?? creator, 'browseId')
  const channelText = text(author) || text(object(creator)?.text) || parts.map((part) => text(object(object(part)?.avatarStack)?.text)).find(Boolean) ||
    parts.map((part) => text(object(part)?.text)).find((label) => label && !/^\d|\b(?:views?|watching|ago)\b/i.test(label))
  const image = data.thumbnail ?? data.contentImage
  const url = find(image, 'url')
  const badge = object(find(data.contentImage, 'thumbnailBadgeViewModel'))
  const badges = find(data.contentImage, 'thumbnailBadges')
  const durations = Array.isArray(badges) ? badges.map((item) => text(object(object(item)?.thumbnailBadgeViewModel)?.text)) : [text(badge?.text)]
  const duration = text(data.lengthText) || durations.find((label) => /^(?:\d+:)?\d+:\d{2}$|^LIVE$/.test(label))
  const menu = [data.menu, data.menuOnTap, metadata?.menuButton]
  return { video: { videoId: id, title,
    channelId: typeof channelId === 'string' && channelId.startsWith('UC') ? channelId : null,
    channelName: channelText || '(unknown)',
    thumbnailUrl: typeof url === 'string' && url.startsWith('https://') ? url : null,
    durationText: duration || null,
    viewCountText: text(data.viewCountText) || text(overlay?.secondaryText) || null,
    publishedText: text(data.publishedTimeText) || null }, feedbackToken: removalToken(menu),
    isShort: ['shortsLockupViewModel', 'reelItemRenderer'].includes(kind) || data.contentType === 'LOCKUP_CONTENT_TYPE_SHORT' || data.isShort === true ||
      !!find(data.navigationEndpoint ?? data.onTap, 'reelWatchEndpoint') }
}

// Walk the response's ordered feed, not YouTube.js's type-grouped video memo.
// Stop at a video so its menus/metadata cannot introduce unrelated entries.
// Preserve Shorts identity instead of flattening YouTube's pinned shelf into
// ordinary cards: shelf position does not establish mixed watch chronology.
export function parseYoutubeHistoryFeed(response: unknown): HistoryFeed {
  const items: HistoryFeedItem[] = []
  const seen = new Set<string>()
  let continuation: string | null = null
  let visited = 0
  const walk = (value: unknown, allowContinuation = true, depth = 0, shortsShelf = false): void => {
    if (depth > 40 || ++visited > 50_000 || !value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach((child) => walk(child, allowContinuation, depth + 1, shortsShelf)); return }
    const data = value as Data
    for (const [key, child] of Object.entries(data)) {
      if (['videoRenderer', 'compactVideoRenderer', 'gridVideoRenderer', 'lockupViewModel', 'shortsLockupViewModel', 'reelItemRenderer'].includes(key)) {
        const item = videoItem(key, child)
        if (item && !seen.has(item.video.videoId)) { item.isShort ||= shortsShelf; seen.add(item.video.videoId); items.push(item) }
      } else if (key === 'tabRenderer') {
        if (object(child)?.selected !== false) walk(child, allowContinuation, depth + 1, shortsShelf)
      } else if (key === 'continuationItemRenderer') {
        const token = allowContinuation ? find(child, 'token') : null
        if (typeof token === 'string') continuation = token
      } else if (key === 'continuations' && allowContinuation) {
        const token = find(child, 'continuation')
        if (typeof token === 'string') continuation = token
      } else if (!['header', 'sidebar', 'secondaryContents', 'menu', 'trackingParams'].includes(key)) {
        const shelf = object(child)
        const isShortsShelf = key === 'reelShelfRenderer' || shelf?.isShorts === true ||
          (['richShelfRenderer', 'shelfRenderer'].includes(key) && (/^shorts$/i.test(text(shelf?.title)) || find(shelf?.icon, 'iconType') === 'SHORTS'))
        walk(child, allowContinuation && !['reelShelfRenderer', 'richShelfRenderer', 'horizontalListRenderer'].includes(key), depth + 1, shortsShelf || isShortsShelf)
      }
    }
  }
  const data = object(response)
  for (const key of ['contents', 'continuationContents', 'onResponseReceivedActions', 'onResponseReceivedCommands', 'onResponseReceivedEndpoints']) walk(data?.[key])
  const actions = find(response, 'browseFeedActionsRenderer')
  const paused = JSON.stringify(actions ?? {}).includes('PLAY_OUTLINED')
  return { items, continuation, paused }
}
