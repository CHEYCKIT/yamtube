import { useEffect, useRef } from 'react'
import { parsePath } from 'react-router-dom'
import { useAppTabs } from '../tabs/AppTabs'

// Native PiP keeps the tab's persistent video alive while its page changes.
// Read current navigation/video state when the native window emits its events;
// an account change, closed tab or queue advance must not restore a stale video.
export function usePictureInPictureNavigation(video: HTMLVideoElement | null, tabId: string, videoId: string | null, isWatchRoute: boolean, parkPlayer: () => void) {
  const tabs = useAppTabs()
  const latest = useRef({ tabs, videoId, parkPlayer })
  latest.current = { tabs, videoId, parkPlayer }
  const origin = useRef<{ videoId: string; path: string } | null>(null)

  useEffect(() => {
    if (!video) return
    const enter = () => {
      const { tabs, videoId } = latest.current
      const owner = tabs.tabs.find((tab) => tab.id === tabId)
      if (!owner || !videoId) return
      const path = owner.entries[owner.index]
      origin.current = { videoId, path: parsePath(path).pathname === `/watch/${videoId}` ? path : `/watch/${videoId}` }
      // Park before React removes the watch page. Removing the PiP video's
      // ancestor from the document would otherwise close the native window.
      latest.current.parkPlayer()
      tabs.select(tabId)
      if (path !== '/') tabs.navigatorFor(tabId).push('/')
    }
    const leave = () => {
      const { tabs, videoId } = latest.current
      const owner = tabs.tabs.find((tab) => tab.id === tabId)
      if (!owner || !videoId || (document.pictureInPictureElement && document.pictureInPictureElement !== video)) return
      const path = origin.current?.videoId === videoId ? origin.current.path : `/watch/${videoId}`
      origin.current = null
      tabs.select(tabId)
      if (parsePath(owner.entries[owner.index]).pathname !== `/watch/${videoId}`) tabs.navigatorFor(tabId).push(path)
    }
    video.addEventListener('enterpictureinpicture', enter)
    video.addEventListener('leavepictureinpicture', leave)
    return () => {
      video.removeEventListener('enterpictureinpicture', enter)
      video.removeEventListener('leavepictureinpicture', leave)
    }
  }, [video, tabId])

  useEffect(() => {
    // Opening the full watch page (including Back or a video link) also ends
    // PiP. The leave handler sees that page and does not add another history entry.
    if (isWatchRoute && video && document.pictureInPictureElement === video) {
      void document.exitPictureInPicture().catch((error) => console.warn('[player] Could not leave picture in picture', error))
    }
  }, [isWatchRoute, video, videoId])
}
