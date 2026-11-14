/**
 * YouTube's Breaking News and Top News shelves can appear in the signed-in
 * home response even when the rest of the feed is personalized. HomeFeed's
 * videos memo gathers items from all shelves, losing the source distinction.
 *
 * Remove editorial news shelves from the raw browse tree BEFORE parsing it.
 * Search, subscriptions and individual watch pages are deliberately untouched.
 */
type JsonRecord = Record<string, unknown>
function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord : null
}

function label(value: unknown): string {
  if (typeof value === 'string') return value
  const data = record(value)
  if (!data) return ''
  if (typeof data.simpleText === 'string') return data.simpleText
  if (typeof data.content === 'string') return data.content
  if (Array.isArray(data.runs))
    return data.runs.map((run) => record(run)?.text).filter((part): part is string => typeof part === 'string').join('')
  if (data.title) return label(data.title)
  if (data.text) return label(data.text)
  return ''
}

export function isNewsShelfHeading(title: string): boolean {
  // Localized headings from YouTube's editorial news shelves. Matching whole
  // shelf headings avoids hiding arbitrary videos about current events.
  const heading = title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim()
  return /^(?:breaking news|top news|latest news|live news|news|news for you|news headlines|headlines|top stories|today's news|world news|local news|actualites|dernieres actualites|actualites a la une|infos du jour|a la une|noticias|ultimas noticias|noticias de ultima hora|noticias destacadas|nachrichten|aktuelle nachrichten|eilnachrichten|notizie|ultime notizie)(?:\s*[:\u2013\u2014-]\s*.+)?$/u.test(heading)
}

function isEditorialNewsShelf(value: unknown): boolean {
  const data = record(value)
  if (!data) return false
  for (const key of ['richShelfRenderer', 'shelfRenderer', 'reelShelfRenderer', 'gridShelfViewModel']) {
    const shelf = record(data[key])
    if (!shelf) continue
    const header = record(shelf.header)
    const title = label(shelf.title) || label(header?.title) ||
      label(header?.titleText) || label(record(header?.gridShelfViewModel)?.title)
    if (isNewsShelfHeading(title)) return true
  }
  // Drop the enclosing section, not just its content: youtubei.js requires
  // RichSectionRenderer.content to exist.
  const rich = record(data.richSectionRenderer)
  if (rich?.content && isEditorialNewsShelf(rich.content)) return true
  const item = record(data.itemSectionRenderer)
  const contents = item?.contents
  if (Array.isArray(contents) && contents.length > 0 && contents.every(isEditorialNewsShelf)) return true
  return false
}

export function removeHomeNewsShelves<T>(home: T): { value: T; removed: number } {
  let removed = 0
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > 60) return value
    if (Array.isArray(value)) {
      let changed = false
      const updated: unknown[] = []
      for (const entry of value) {
        if (isEditorialNewsShelf(entry)) { removed++; changed = true; continue }
        const next = visit(entry, depth + 1)
        if (next !== entry) changed = true
        updated.push(next)
      }
      return changed ? updated : value
    }
    const data = record(value)
    if (!data) return value
    let updated: JsonRecord | null = null
    for (const [key, entry] of Object.entries(data)) {
      const next = visit(entry, depth + 1)
      if (next !== entry) {
        if (!updated) updated = { ...data }
        updated[key] = next
      }
    }
    return updated ?? value
  }
  return { value: visit(home, 0) as T, removed }
}

/**
 * A narrow second pass catches standalone broadcaster tiles YouTube injects
 * outside named news shelves. We never classify by video title: that would
 * also discard a user's organic non-news recommendations.
 */
export function isNewsBroadcaster(channelName: string): boolean {
  const name = channelName.normalize('NFKD').replace(/\p{M}/gu, '').trim()
  if (!name) return false
  return /^(?:(?:fox|abc)(?:\s*(?:news|business|action news|\d{1,2}(?:\s|$)))|(?:\d{1,2}\s+news(?:\s|$))|(?:news\s+\d{1,2}(?:\s|$))|(?:cnn|msnbc|nbc news|cbs news|bbc news|sky news|ap news|associated press|reuters|al jazeera|france 24|euronews|newsmax|newsnation)(?:\s|$)|(?:[a-z0-9 ]+\snews(?:\s|$)))/i.test(name)
}

export function excludeHomeNewsBroadcasters<T extends { channelName: string }>(videos: readonly T[]): T[] {
  return videos.filter((video) => !isNewsBroadcaster(video.channelName))
}
