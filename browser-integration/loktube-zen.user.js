// ==UserScript==
// @name         Open YouTube links in LokTube
// @namespace    https://github.com/lokal-music/loktube
// @version      1.5.1
// @description  Open clicked YouTube links from Zen/Firefox in new LokTube tabs.
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

// Works with Violentmonkey in Zen/Firefox. The OS may show a one-time
// confirmation for the external loktube: protocol. This script accesses
// link destinations on websites but never reads cookies or sends network data.
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
    if (!parts.length) return true
    if (parts[0] === 'watch') return video.test(url.searchParams.get('v') || '')
    if (['shorts','live','embed'].includes(parts[0]))
      return parts.length === 2 && video.test(parts[1])
    if (parts[0] === 'playlist') return /^[A-Za-z0-9_-]{6,120}$/.test(url.searchParams.get('list') || '')
    if (parts[0] === 'channel') return parts.length === 2 && /^UC[A-Za-z0-9_-]{20,64}$/.test(parts[1])
    if (parts[0] === 'results') return !!(url.searchParams.get('search_query') || '').trim()
    if (parts[0] === 'feed') return parts.length === 2 && ['subscriptions','history'].includes(parts[1])
    return parts.length === 1 && /^@[A-Za-z0-9._-]{3,40}$/.test(parts[0])
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
