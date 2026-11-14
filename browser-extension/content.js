// Firefox / Zen add-on. No cookies, accounts or remote API requests are used.
(() => {
  'use strict'
  const hosts = new Set(['youtube.com','www.youtube.com','m.youtube.com',
    'music.youtube.com','youtu.be','www.youtu.be'])
  const video = /^[A-Za-z0-9_-]{11}$/
  function eligible(href) {
    if (typeof href !== 'string' || href.length > 3000) return false
    let url
    try { url = new URL(href) } catch { return false }
    if (!['https:','http:'].includes(url.protocol) || !hosts.has(url.hostname.toLowerCase()) ||
      url.username || url.password || url.port) return false
    const parts = url.pathname.split('/').filter(Boolean)
    if (['youtu.be','www.youtu.be'].includes(url.hostname.toLowerCase()))
      return parts.length === 1 && video.test(parts[0])
    if (parts[0] === 'watch')
      return parts.length === 1 && video.test(url.searchParams.get('v') || '')
    if (['shorts','live','embed'].includes(parts[0]))
      return parts.length === 2 && video.test(parts[1])
    // Other YouTube destinations stay in Zen: Home, History, subscriptions,
    // playlists, channel pages, searches, settings and related navigation.
    return false
  }
  window.addEventListener('click', event => {
    if (!event.isTrusted || event.defaultPrevented || event.button !== 0 ||
      event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return
    const anchor = event.target?.closest?.('a[href]')
    if (!anchor || anchor.hasAttribute('download')) return
    let url
    try { url = new URL(anchor.href) } catch { return }
    if (!eligible(url.href)) return
    if (url.protocol === 'http:') url.protocol = 'https:'
    event.preventDefault()
    event.stopImmediatePropagation()
    // Synchronous user-gesture navigation preserves browser OS confirmation.
    window.location.assign('loktube://open?url=' + encodeURIComponent(url.href))
  }, true)
})()
