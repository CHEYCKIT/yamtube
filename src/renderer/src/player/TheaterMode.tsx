import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAppTabs } from '../tabs/AppTabs'
import { THEATER_STATE_EVENT, THEATER_TOGGLE_EVENT } from './events'

const TheaterContext = createContext({ active: false })
export const useTheaterMode = () => useContext(TheaterContext)
const preferenceKey = 'loktube:theater-mode'

export function TheaterModeProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { activeId } = useAppTabs()
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(preferenceKey) === 'true' } catch { return false }
  })
  const isWatch = pathname.startsWith('/watch/')
  const active = enabled && isWatch

  useEffect(() => {
    try { localStorage.setItem(preferenceKey, String(enabled)) } catch { /* Still works for this session. */ }
  }, [enabled])
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(THEATER_STATE_EVENT, { detail: { active } }))
  }, [active, activeId])
  useEffect(() => {
    const toggle = (event: Event) => {
      if (isWatch && (event as CustomEvent<{ tabId: string }>).detail?.tabId === activeId) {
        setEnabled((value) => !value)
        window.scrollTo({ top: 0, behavior: 'instant' })
      }
    }
    const keyboard = (event: KeyboardEvent) => {
      if (!isWatch || document.fullscreenElement || event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      const target = event.target instanceof Element ? event.target : document.activeElement
      if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], dialog, [role="dialog"]')) return
      if (event.key.toLowerCase() !== 't') return
      event.preventDefault()
      setEnabled((value) => !value)
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
    window.addEventListener(THEATER_TOGGLE_EVENT, toggle)
    window.addEventListener('keydown', keyboard)
    return () => {
      window.removeEventListener(THEATER_TOGGLE_EVENT, toggle)
      window.removeEventListener('keydown', keyboard)
    }
  }, [isWatch, activeId])
  return <TheaterContext.Provider value={{ active }}>{children}</TheaterContext.Provider>
}

// An immediate CSS :hover retracts mid-animation when the pointer moves off the
// edge trigger. Retain the reveal while crossing into the toolbar or its menus.
export function useTheaterHeaderReveal(active: boolean): boolean {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    setVisible(false)
    if (!active) return
    let shown = false
    let lastY = Number.POSITIVE_INFINITY
    let timer: ReturnType<typeof setTimeout> | undefined
    const toolbar = '.wt-topbar, .wt-tabbar, .wt-theater-top-edge'
    const cancel = () => { if (timer) { clearTimeout(timer); timer = undefined } }
    const show = () => { cancel(); shown = true; setVisible(true) }
    const focused = () => !!document.activeElement?.closest(toolbar)
    const hideLater = () => {
      if (timer || focused()) return
      timer = setTimeout(() => {
        timer = undefined
        if (focused()) return
        shown = false; setVisible(false)
      }, 850)
    }
    const move = (event: PointerEvent) => {
      lastY = event.clientY
      if (document.fullscreenElement) return
      const target = event.target instanceof Element ? event.target : null
      if (lastY <= 36 || (shown && lastY <= 136) || target?.closest(toolbar)) show()
      else hideLater()
    }
    const focus = () => { if (focused()) show(); else if (lastY > 136) hideLater() }
    const leave = () => { lastY = Number.POSITIVE_INFINITY; hideLater() }
    const fullscreen = () => {
      if (document.fullscreenElement) { cancel(); shown = false; setVisible(false) }
    }
    document.addEventListener('pointermove', move, true)
    document.addEventListener('pointerleave', leave)
    document.addEventListener('focusin', focus)
    document.addEventListener('focusout', focus)
    document.addEventListener('fullscreenchange', fullscreen)
    return () => {
      cancel()
      document.removeEventListener('pointermove', move, true)
      document.removeEventListener('pointerleave', leave)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('focusout', focus)
      document.removeEventListener('fullscreenchange', fullscreen)
    }
  }, [active])
  return active && visible
}
