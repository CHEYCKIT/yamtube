import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { PageLoader } from '../components/PageLoader'
import type { LocalSessionState, LocalUser, UserProfile, YoutubeAccountState } from '../../../shared/ipc'

interface ProfileContextValue extends LocalSessionState {
  activeUser: LocalUser
  activeProfile: UserProfile
  activeProfileId: string
  youtubeAccount: YoutubeAccountState
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LocalSessionState | null>(null)
  const [account, setAccount] = useState<YoutubeAccountState | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.api.onYoutubeAccount((next) => { if (!cancelled) setAccount(next) })
    Promise.all([window.api.getSessionState(), window.api.getYoutubeAccount()]).then(([library, youtube]) => {
      if (!cancelled) { setState(library); setAccount(youtube) }
    }).catch(() => { if (!cancelled) setError('Unable to open your library. Restart WorldTube and try again.') })
    return () => { cancelled = true; unsubscribe() }
  }, [])
  if (error) return <div className="p-8 text-red-400" role="alert">{error}</div>
  if (!state || !account) return <PageLoader fullScreen />
  if (!state.activeUser || !state.activeProfile || !state.activeProfileId) {
    return <div className="p-8 text-red-400" role="alert">Unable to open your library. Restart WorldTube and try again.</div>
  }
  return <ProfileContext.Provider value={{ ...state, activeUser: state.activeUser, activeProfile: state.activeProfile,
    activeProfileId: state.activeProfileId, youtubeAccount: account }}>{children}</ProfileContext.Provider>
}

export function useProfiles(): ProfileContextValue {
  const context = useContext(ProfileContext)
  if (!context) throw new Error('useProfiles must be used inside ProfileProvider')
  return context
}
