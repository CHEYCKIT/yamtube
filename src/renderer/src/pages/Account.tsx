import { useEffect, useState } from 'react'
import { ShieldCheck, TvMinimal } from 'lucide-react'
import { ApplicationSettings } from '../components/ApplicationSettings'
import { DiagnosticLogs } from '../components/DiagnosticLogs'
import { useProfiles } from '../profiles/ProfileContext'
import type { ProtectionState, SignInBrowserState } from '../../../shared/ipc'

const button = 'rounded bg-neutral-800 px-4 py-2 text-sm font-medium hover:bg-neutral-700 disabled:cursor-wait disabled:opacity-50'

export function Account() {
  const { youtubeAccount: account, dataPath } = useProfiles()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [protection, setProtection] = useState<ProtectionState | null>(null)
  const [browsers, setBrowsers] = useState<SignInBrowserState | null>(null)
  const browserName = browsers?.browsers.find(({ id }) => id === browsers.selectedId)?.name ?? 'browser'
  useEffect(() => {
    let cancelled = false
    const refresh = () => window.api.getProtection().then((next) => { if (!cancelled) setProtection(next) }).catch(() => undefined)
    void refresh()
    void window.api.getSignInBrowsers().then((next) => { if (!cancelled) setBrowsers(next) }).catch(() => { if (!cancelled) setError('Sign-in browsers could not be detected. Try Refresh browsers or import YouTube cookies.') })
    const timer = window.setInterval(refresh, 5_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])

  async function run(kind: string, action: () => Promise<unknown>, reload = false) {
    setBusy(kind); setError(null); setMessage(null)
    try {
      const result = await action()
      // Remount all tabs/players after account changes; stale playback must
      // never write into the new account's library or history.
      if (reload && result !== null) window.location.reload()
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(failure)
      setError(detail)
    } finally { setBusy(null) }
  }

  return <div className="mx-auto grid max-w-3xl gap-8 pb-10">
    <h1 className="text-xl font-semibold">Account & privacy</h1>
    <section className="grid gap-4 rounded border border-neutral-800 bg-neutral-900/50 p-5">
      <div className="flex items-center gap-3">
        {account.avatarUrl ? <img src={account.avatarUrl} alt="" className="h-11 w-11 rounded-full" /> : <TvMinimal className="h-9 w-9 text-red-400" />}
        <div><h2 className="font-semibold">{account.name ?? 'Sign in to YouTube'}</h2>
          <p className="text-sm text-neutral-400">{account.signedIn ? 'Connected to your YouTube account' : 'Your recommendations, subscriptions and watch history'}</p></div>
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <p className="text-sm leading-relaxed text-neutral-400">Sign in with Google in your selected browser, then close that sign-in window to finish connecting. Zen, Firefox, LibreWolf, Waterfox and Floorp are supported. Your existing browser profiles are kept separate.</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1 text-sm text-neutral-300"><label htmlFor="youtube-signin-browser">Sign-in browser</label>
          <select id="youtube-signin-browser" className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" value={browsers?.selectedId ?? ''} disabled={!!busy || !browsers?.browsers.length}
            onChange={(event) => { const id = event.target.value; void run('browser', async () => setBrowsers(await window.api.selectSignInBrowser(id))) }}>
            {!browsers?.browsers.length && <option value="">{browsers ? 'No supported browser detected' : 'Detecting browsers…'}</option>}
            {browsers?.browsers.map((browser, index, all) => <option key={browser.id} value={browser.id}>{browser.name}{all.filter(({ name }) => name === browser.name).length > 1 ? ` (${all.slice(0, index + 1).filter(({ name }) => name === browser.name).length})` : ''}</option>)}
          </select>
        </div>
        <button disabled={!!busy} className={button} onClick={() => void run('detect', async () => setBrowsers(await window.api.getSignInBrowsers(true)))}>Refresh browsers</button>
        <button disabled={!!busy} className={button} onClick={() => void run('addbrowser', async () => setBrowsers(await window.api.addSignInBrowser()))}>Add portable browser…</button>
      </div>
      {browsers && !browsers.browsers.length && <p className="text-sm text-neutral-400">Install Zen or Firefox and refresh, or add a portable installation once. You can also import cookies from any browser.</p>}
      <div className="flex flex-wrap gap-2">
        <button disabled={!!busy || !browsers?.selectedId} onClick={() => void run('signin', () => window.api.signInYoutube(browsers?.selectedId ?? undefined), true)} className="wt-action-important rounded px-4 py-2 text-sm font-medium disabled:opacity-50">
          {busy === 'signin' ? `Waiting for ${browserName}…` : `${account.signedIn ? 'Reconnect' : 'Sign in'} with ${browserName}`}</button>
        <button disabled={!!busy} onClick={() => void run('cookies', window.api.importYoutubeCookies, true)} className={button}>Import YouTube cookies</button>
        {account.signedIn && <button disabled={!!busy} onClick={() => void run('signout', window.api.signOutYoutube, true)} className={button}>Sign out</button>}
        {busy === 'signin' && <button onClick={() => void window.api.cancelYoutubeSignIn()} className={button}>Cancel sign-in</button>}
      </div>
      {busy === 'signin' && <p role="status" className="text-sm text-neutral-300">Complete sign-in on youtube.com in {browserName}. Close that sign-in window when YouTube shows your account avatar. This app never asks for your Google password.</p>}
      {account.signedIn && <p className="text-sm text-neutral-400">{account.persistent ? 'Your session is encrypted using your system keyring.' : 'Session only: secure system storage is unavailable. You will need to sign in again after quitting.'} Signing out disconnects this app.</p>}
      {!account.signedIn && <p className="text-sm text-neutral-500">You can keep browsing as a guest. No local account or password is required.</p>}
      {account.error && <p role="alert" className="text-sm text-amber-300">{account.error}</p>}
      {account.syncError && <p role="alert" className="text-sm text-amber-300">{account.syncError}</p>}
      <details className="text-sm text-neutral-400"><summary className="cursor-pointer">Using an existing browser session</summary>
        <p className="mt-2">Import a Netscape cookies.txt or Cookie-Editor JSON export from any browser signed in to youtube.com, including Zen, Chrome and Edge. Choose the YouTube account you want before exporting. Only YouTube cookies are read. Treat the export like a password and delete it after import. Account sync uses YouTube’s private API and may need reconnecting when YouTube changes.</p>
      </details>
    </section>
    <section className="grid gap-3">
      <h2 className="flex items-center gap-2 border-b border-neutral-800 pb-2 font-semibold"><ShieldCheck className="h-5 w-5 text-emerald-400" /> Ad & tracking protection</h2>
      <p className="text-sm text-neutral-300">Always on across app windows, media requests and background YouTube requests. EasyList and EasyPrivacy are included, so protection works from the first launch.</p>
      <p className="text-sm text-neutral-400">{protection ? `${protection.blocked.toLocaleString()} requests blocked this session · Filters: ${protection.updatedAt}` : 'Loading protection status…'}</p>
      <div><button disabled={!!busy} className={button} onClick={() => void run('filters', async () => {
        setProtection(await window.api.updateProtection()); setMessage('Filter lists updated.')
      })}>{busy === 'filters' ? 'Updating…' : 'Update filter lists'}</button></div>
      <p className="text-sm text-neutral-500">Videos play through the direct-stream player. Watch-history sync is allowed when you sign in. The desktop shell still uses Electron; protection does not require a Chrome extension.</p>
    </section>
    <ApplicationSettings />
    <DiagnosticLogs />
    <details className="border-t border-neutral-800 pt-4 text-sm text-neutral-400"><summary className="cursor-pointer font-medium">Local library & backups</summary>
      <div className="mt-3 grid gap-3">
        <p className="break-all">{dataPath}</p>
        <p>Saved videos, playlists and guest history stay on this device. YouTube credentials are kept separately and are never included in library exports. Existing local libraries are retained in backups.</p>
        <div className="flex flex-wrap gap-2">
          <button disabled={!!busy} className={button} onClick={() => void run('export', async () => {
            const path = await window.api.exportData(); if (path) setMessage(`Library exported to ${path}`)
          })}>Export library</button>
          <button disabled={!!busy} className={button} onClick={() => void run('import', window.api.importData, true)}>Import library</button>
        </div>
      </div>
    </details>
    {message && <p role="status" className="text-sm text-emerald-400">{message}</p>}
  </div>
}
