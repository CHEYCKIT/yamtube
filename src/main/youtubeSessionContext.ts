/**
 * Only the account-selection fields from YouTube's own ytcfg page data.
 * Never send these fields or raw cookies to the renderer or logs.
 */
export interface YoutubeWebContext {
  accountIndex?: number
  pageId?: string
  visitorData?: string
  language?: string
  region?: string
  userAgent?: string
  loggedIn?: boolean
}

type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as ObjectValue : null
const clean = (value: unknown, regex: RegExp, max = 300): string | undefined =>
  typeof value === 'string' && value.length <= max && regex.test(value) ? value : undefined

export function parseYoutubeWebContext(value: unknown): YoutubeWebContext | null {
  const raw = object(value)
  if (!raw) return null
  const inner = object(raw.INNERTUBE_CONTEXT)
  const client = object(inner?.client)
  const result: YoutubeWebContext = {}
  const index = raw['x-goog-authuser'] ?? raw.SESSION_INDEX
  const indexText = typeof index === 'number' ? String(index) : index
  if (typeof indexText === 'string' && /^\d{1,2}$/.test(indexText))
    result.accountIndex = Number(indexText)
  const pageId = clean(raw['x-goog-pageid'] ?? raw.DELEGATED_SESSION_ID, /^[a-zA-Z0-9_-]{4,128}$/, 128)
  if (pageId) result.pageId = pageId
  const visitor = clean(raw['x-goog-visitor-id'] ?? raw.VISITOR_DATA ?? client?.visitorData,
    /^[a-zA-Z0-9_=-]{6,300}$/)
  if (visitor) result.visitorData = visitor
  const language = clean(raw.hl ?? client?.hl, /^[a-z]{2,3}(?:[-_][a-zA-Z]{2,5})?$/, 16)
  if (language) result.language = language
  const region = clean(raw.gl ?? client?.gl, /^[A-Z]{2}$/)
  if (region) result.region = region
  const userAgent = clean(raw.userAgent ?? client?.userAgent, /^[^\r\n\x00-\x1f]{15,500}$/, 500)
  if (userAgent) result.userAgent = userAgent
  if (raw.loggedIn === true || raw.loggedIn === 'true' || raw.LOGGED_IN === true) result.loggedIn = true
  if (raw.loggedIn === false || raw.loggedIn === 'false' || raw.LOGGED_IN === false) result.loggedIn = false
  return Object.keys(result).length ? result : null
}

/**
 * Read an authenticated site's ytcfg.set({...}) block without executing HTML
 * JavaScript. This is only used to upgrade pre-1.4.0 saved sessions.
 */
export function extractYoutubePageContext(html: string): YoutubeWebContext | null {
  if (html.length > 4_000_000) return null
  const marker = /ytcfg\.set\(\s*/g
  for (const match of html.matchAll(marker)) {
    const start = match.index + match[0].length
    if (html[start] !== '{') continue
    let depth = 0, quote = false, escape = false, end = -1
    for (let index = start; index < html.length && index - start < 200_000; index++) {
      const char = html[index]
      if (quote) {
        if (escape) escape = false
        else if (char === '\\') escape = true
        else if (char === '"') quote = false
      } else if (char === '"') quote = true
      else if (char === '{') depth++
      else if (char === '}' && --depth === 0) { end = index + 1; break }
    }
    if (end < 0) continue
    try {
      const context = parseYoutubeWebContext(JSON.parse(html.slice(start, end)))
      if (context?.loggedIn === true) return context
    } catch { /* Invalid or unrelated ytcfg.set payload. */ }
  }
  return null
}

/** Explicitly signed-out InnerTube browse results are never personalized. */
export function isGuestYoutubeHome(response: unknown): boolean {
  const main = object(object(response)?.responseContext)
  const web = object(main?.mainAppWebResponseContext)
  return web?.loggedOut === true
}
