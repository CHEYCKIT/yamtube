/**
 * External protocol ingress. Only known YouTube HTTPS paths become local
 * app routes; raw URLs never enter the renderer as navigation targets.
 */
const VIDEO = /^[A-Za-z0-9_-]{11}$/
const CHANNEL = /^UC[A-Za-z0-9_-]{20,64}$/
const PLAYLIST = /^[A-Za-z0-9_-]{6,120}$/
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com',
  'music.youtube.com', 'youtu.be', 'www.youtu.be'])

export function youtubeUrlToAppRoute(value: string): string | null {
  if (typeof value !== 'string' || value.length < 12 || value.length > 3000) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname.toLowerCase()) ||
    url.username || url.password || url.port) return null
  const pieces = url.pathname.split('/').filter(Boolean)
  if (url.hostname.toLowerCase().endsWith('youtu.be'))
    return pieces.length === 1 && VIDEO.test(pieces[0]) ? '/watch/' + pieces[0] : null
  if (!pieces.length) return '/'
  if (pieces[0] === 'watch') {
    const id = url.searchParams.get('v')
    return id && VIDEO.test(id) ? '/watch/' + id : null
  }
  if (['shorts', 'live', 'embed'].includes(pieces[0]) && pieces.length === 2)
    return VIDEO.test(pieces[1]) ? '/watch/' + pieces[1] : null
  if (pieces[0] === 'playlist') {
    const id = url.searchParams.get('list')
    return id && PLAYLIST.test(id) ? '/collection/playlist/' + id : null
  }
  if (pieces[0] === 'channel' && pieces.length === 2 && CHANNEL.test(pieces[1]))
    return '/channel/' + pieces[1]
  if (pieces[0] === 'results') {
    const q = (url.searchParams.get('search_query') ?? '').trim()
    return q && q.length <= 200 ? '/search?q=' + encodeURIComponent(q) : null
  }
  if (pieces.length === 2 && pieces[0] === 'feed') {
    if (pieces[1] === 'subscriptions') return '/subscriptions'
    if (pieces[1] === 'history') return '/history'
  }
  // @handles require channel ID resolution; open a handle search rather than
  // invent an invalid /channel/:id URL.
  if (pieces.length === 1 && /^@[A-Za-z0-9._-]{3,40}$/.test(pieces[0]))
    return '/search?q=' + encodeURIComponent(pieces[0])
  return null
}

export function loktubeProtocolToRoute(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096 || !/^loktube:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'loktube:' || url.hostname !== 'open' ||
      url.username || url.password || url.port || url.hash ||
      (url.pathname && url.pathname !== '/') ||
      [...url.searchParams.keys()].some(key => key !== 'url')) return null
    const links = url.searchParams.getAll('url')
    return links.length === 1 ? youtubeUrlToAppRoute(links[0]) : null
  } catch { return null }
}
