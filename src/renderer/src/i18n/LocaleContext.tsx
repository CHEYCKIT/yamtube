import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { translateFor, type AppLanguage, type AppPreferences } from '../../../shared/locale'

let currentLanguage: AppLanguage = 'en'
export const t = (source: string, values?: Record<string, string | number>) => translateFor(currentLanguage, source, values)
export const locale = () => currentLanguage === 'es' ? 'es-UY' : 'en-US'

export const LocaleContext = createContext({
  language: 'en' as AppLanguage,
  checkForUpdatesOnStartup: true,
  autoplayNext: true,
  savePreferences: async (_preferences: AppPreferences): Promise<void> => {},
  error: null as string | null
})

export const useLocale = () => useContext(LocaleContext)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<AppPreferences>({ language: 'en', checkForUpdatesOnStartup: true, autoplayNext: true })
  const [error, setError] = useState<string | null>(null)
  currentLanguage = preferences.language

  useEffect(() => {
    document.documentElement.lang = preferences.language
  }, [preferences.language])

  useEffect(() => {
    if (typeof window.api.getAppPreferences !== 'function') return
    let cancelled = false
    const load = () => window.api.getAppPreferences().then((saved) => {
      if (!cancelled) setPreferences({ ...saved, autoplayNext: saved.autoplayNext !== false })
    }).catch((failure) => {
      if (!cancelled) setError(String(failure))
    })
    void load()
    window.addEventListener('worldtube:preferences-changed', load)
    return () => { cancelled = true; window.removeEventListener('worldtube:preferences-changed', load) }
  }, [])

  async function savePreferences(next: AppPreferences) {
    if (typeof window.api.setAppPreferences !== 'function') {
      setError(t('Restart YamTube to save application settings.'))
      return
    }
    try {
      const merged = { ...next, autoplayNext: next.autoplayNext ?? preferences.autoplayNext ?? true }
      await window.api.setAppPreferences(merged)
      setPreferences(merged)
      window.dispatchEvent(new Event('worldtube:preferences-changed'))
      setError(null)
    } catch (failure) { setError(String(failure)) }
  }

  return <LocaleContext.Provider value={{ ...preferences, autoplayNext: preferences.autoplayNext !== false, savePreferences, error }}>{children}</LocaleContext.Provider>
}
