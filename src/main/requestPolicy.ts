import { FiltersEngine, Request as FilterRequest, type RequestType } from '@ghostery/adblocker'

// These two endpoints are the user's explicit watch-history sync, not ads.
// Keep this exception narrow: other /api/stats endpoints remain filtered.
export function isWatchHistoryRequest(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname === 'www.youtube.com' &&
    ['/api/stats/playback', '/api/stats/watchtime'].includes(url.pathname)
}

export class RequestPolicy {
  private engine: FiltersEngine
  blocked = 0

  constructor(filters: string) {
    this.engine = FiltersEngine.parse(filters, { loadCosmeticFilters: false, enableCompression: true })
  }

  blocks(url: string, type: RequestType = 'fetch', sourceUrl = 'https://www.youtube.com/'): boolean {
    const target = new URL(url)
    if (!['https:', 'http:', 'ws:', 'wss:'].includes(target.protocol) || isWatchHistoryRequest(target)) return false
    const { match } = this.engine.match(FilterRequest.fromRawDetails({ url, type, sourceUrl }))
    if (match) this.blocked++
    return match
  }
}

// Never let YouTube credentials follow a cross-origin redirect. The browser
// credential store is disabled on app requests; only this request carries them.
export function redirectHeaders(headers: Headers, previous: URL, next: URL): Headers {
  const result = new Headers(headers)
  if (previous.origin !== next.origin) {
    for (const name of ['cookie', 'authorization', 'x-goog-authuser', 'x-goog-pageid']) result.delete(name)
  }
  return result
}

export function scopedCredentialHeaders(headers: Headers, target: URL): Headers {
  const result = new Headers(headers)
  // InnerTube's HTTPClient can attach auth when given an absolute URL too.
  // Only the API and the two history endpoints may receive the account jar.
  if (target.protocol !== 'https:' || target.hostname !== 'www.youtube.com' || target.port ||
    (!target.pathname.startsWith('/youtubei/v1/') && !isWatchHistoryRequest(target))) {
    for (const name of ['cookie', 'authorization', 'x-goog-authuser', 'x-goog-pageid']) result.delete(name)
  }
  return result
}
