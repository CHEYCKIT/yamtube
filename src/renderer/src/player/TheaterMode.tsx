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
