import { useEffect, useMemo, useState } from 'react'

// Music thumbnails from YouTube Music often arrive as 120px Googleusercontent images.
// Request the original artwork at display resolution instead of stretching that preview.
export function musicArtworkCandidates(videoId: string, thumbnailUrl: string | null): string[] {
  const candidates: string[] = []
  if (thumbnailUrl) {
    try {
      const url = new URL(thumbnailUrl)
      if (/^lh\d+\.googleusercontent\.com$/.test(url.hostname) || url.hostname === 'yt3.ggpht.com') {
        // Retain the image ID but replace only the known Google image transform.
        url.pathname = url.pathname.replace(/(?:=s\d+[^/]*|=w\d+[^/]*)$/, '=w1200-h1200-l90-rj')
        if (url.toString() !== thumbnailUrl) candidates.push(url.toString())
      }
    } catch { /* The supplied URL is not usable; generated URLs remain available. */ }
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    for (const size of ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault']) {
      candidates.push(`https://i.ytimg.com/vi/${videoId}/${size}.jpg`)
    }
  }
  if (thumbnailUrl) candidates.push(thumbnailUrl)
  return [...new Set(candidates)]
}

export function MusicArtwork({ videoId, thumbnailUrl, title, className = '' }: {
  videoId: string; thumbnailUrl: string | null; title: string; className?: string
}) {
  const urls = useMemo(() => musicArtworkCandidates(videoId, thumbnailUrl), [videoId, thumbnailUrl])
  const [index, setIndex] = useState(0)
  useEffect(() => setIndex(0), [urls])
  const url = urls[index]
  if (!url) return <div className={`grid h-full w-full place-items-center bg-neutral-900 p-2 text-xs text-neutral-500 ${className}`}>{title}</div>
  return <img key={url} src={url} alt="" decoding="async" loading="lazy" className={`h-full w-full object-cover ${className}`}
    onLoad={(event) => {
      // maxresdefault on unavailable videos sometimes returns a 120x90 placeholder.
      if (event.currentTarget.naturalWidth <= 120 && index < urls.length - 1) setIndex((current) => current === index ? current + 1 : current)
    }}
    onError={() => setIndex((current) => current === index ? current + 1 : current)} />
}
