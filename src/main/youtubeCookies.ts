export interface YoutubeCookie {
  host: string
  name: string
  value: string
  path: string
  expiry: number
}

export function youtubeCookieHeader(cookies: YoutubeCookie[], nowSeconds = Date.now() / 1000): string {
  const accepted = new Map<string, string>()
  // Only cookies sent to https://www.youtube.com/ may enter the app.
  for (const cookie of cookies) {
    if (!['youtube.com', '.youtube.com', 'www.youtube.com', '.www.youtube.com'].includes(cookie.host) ||
      cookie.path !== '/' || (cookie.expiry > 0 && cookie.expiry <= nowSeconds)) continue
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(cookie.name) || /[\x00-\x20\x7f;,]/.test(cookie.value)) continue
    accepted.set(cookie.name, cookie.value)
  }
  // youtubei.js's cookie auth requires SAPISID, including for SAPISIDHASH.
  if (!accepted.get('SAPISID') && accepted.get('__Secure-3PAPISID')) accepted.set('SAPISID', accepted.get('__Secure-3PAPISID')!)
  if (!accepted.get('SAPISID')) throw new Error('No signed-in YouTube session found. Sign in on youtube.com in your browser, then export fresh YouTube cookies or use browser sign-in.')
  return [...accepted].map(([name, value]) => `${name}=${value}`).join('; ')
}

export function parseNetscapeCookies(contents: string): string {
  if (contents.length > 2 * 1024 * 1024) throw new Error('Cookie file is too large')
  const cookies: YoutubeCookie[] = []
  for (let line of contents.split(/\r?\n/)) {
    if (line.startsWith('#HttpOnly_')) line = line.slice('#HttpOnly_'.length)
    if (!line || line.startsWith('#')) continue
    const fields = line.split('\t')
    if (fields.length !== 7 || !/^\d+$/.test(fields[4])) continue
    cookies.push({ host: fields[0], path: fields[2], expiry: Number(fields[4]), name: fields[5], value: fields[6] })
  }
  return youtubeCookieHeader(cookies)
}

export function parseYoutubeCookies(contents: string): string {
  if (contents.length > 2 * 1024 * 1024) throw new Error('Cookie file is too large')
  const trimmed = contents.replace(/^\uFEFF/, '').trim()
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return parseNetscapeCookies(trimmed)
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) } catch { throw new Error('Invalid cookie JSON. Export cookies.txt or Cookie-Editor JSON from youtube.com.') }
  const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? (parsed as { cookies?: unknown }).cookies : null
  if (!Array.isArray(rows)) throw new Error('Expected a Cookie-Editor JSON array or a cookies.txt export.')
  const cookies: YoutubeCookie[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.domain !== 'string' || typeof row.name !== 'string' || typeof row.value !== 'string' || typeof row.path !== 'string') continue
    const expiry = row.expirationDate ?? row.expires
    // Session cookies may omit expiry or explicitly identify themselves as
    // session-only. Persistent cookies must have a valid, future expiry.
    if (row.session !== true && expiry !== undefined && (typeof expiry !== 'number' || !Number.isFinite(expiry) || expiry <= 0)) continue
    cookies.push({ host: row.domain, name: row.name, value: row.value, path: row.path, expiry: row.session === true ? 0 : expiry ?? 0 })
  }
  return youtubeCookieHeader(cookies)
}
