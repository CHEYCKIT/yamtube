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
  if (!accepted.has('SAPISID') && accepted.has('__Secure-3PAPISID')) accepted.set('SAPISID', accepted.get('__Secure-3PAPISID')!)
  if (!accepted.has('SAPISID')) throw new Error('No signed-in YouTube session found. Sign in to YouTube in Firefox first.')
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
