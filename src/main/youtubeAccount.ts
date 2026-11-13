import { app, BrowserWindow, safeStorage } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Innertube } from 'youtubei.js'
import { inspectAccountResponse, type YoutubeIdentity } from './youtubeIdentity'
import { protectedFetch } from './adBlock'
import { IPC_CHANNELS, type YoutubeAccountState } from '../shared/ipc'
import { activateLibraryOwner, getAppLanguage } from './localDb'

interface Credentials {
  cookie: string
  libraryKey: string
  name: string
  avatarUrl: string | null
}

let credentials: Credentials | null = null
let client: Promise<Innertube> | null = null
let playbackClient: Promise<Innertube> | null = null
let clientLanguage: string | null = null
let revision = 0
let state: YoutubeAccountState = { signedIn: false, name: null, avatarUrl: null, persistent: false, error: null, syncError: null }
const credentialPath = () => join(app.getPath('userData'), 'youtube-session.enc')

export const accountRevision = (): number => revision
export const hasYoutubeAccount = (): boolean => credentials !== null
export const youtubeAccountState = (): YoutubeAccountState => ({ ...state })
export const activateCurrentLibrary = (): Promise<void> => activateLibraryOwner(credentials?.libraryKey ?? 'guest', credentials?.name ?? 'Guest')

function publish(change: Partial<YoutubeAccountState>): void {
  state = { ...state, ...change }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.YOUTUBE_ACCOUNT_STATE, youtubeAccountState())
  }
}

function canPersist(): boolean {
  return safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
}

function createClient(cookie?: string, playback = false): Promise<Innertube> {
  return Innertube.create({ cookie, lang: getAppLanguage(), generate_session_locally: true,
    retrieve_player: playback, retrieve_innertube_config: false, fetch: protectedFetch })
}

export function getAccountClient(): Promise<Innertube> {
  if (clientLanguage !== getAppLanguage()) { client = null; playbackClient = null; clientLanguage = getAppLanguage() }
  if (!client) {
    const pending = createClient(credentials?.cookie).catch((error) => {
      if (client === pending) client = null
      throw error
    })
    client = pending
  }
  return client
}

/**
 * Dedicated authenticated player client. Keep the browsing client separate:
 * it intentionally skips fetching Player JS and must not be mutated by
 * video-scoped PO tokens. Cache only for the current signed-in credentials.
 */
export function getAccountPlaybackClient(): Promise<Innertube> {
  if (!credentials) return Promise.reject(new Error('No YouTube account is connected'))
  if (clientLanguage !== getAppLanguage()) { client = null; playbackClient = null; clientLanguage = getAppLanguage() }
  if (!playbackClient) {
    const expectedRevision = revision
    const pending = createClient(credentials.cookie, true).then((yt) => {
      if (revision !== expectedRevision) throw new Error('YouTube account changed during playback authorization')
      return yt
    }).catch((error) => {
      if (playbackClient === pending) playbackClient = null
      throw error
    })
    playbackClient = pending
  }
  return playbackClient
}

export async function initializeYoutubeAccount(): Promise<void> {
  try {
    const encrypted = await readFile(credentialPath())
    if (!canPersist()) {
      publish({ error: 'Unlock your system keyring to restore your YouTube session, or sign in for this session only.' })
    } else {
      const saved = JSON.parse(safeStorage.decryptString(encrypted)) as Credentials
      if (typeof saved.cookie !== 'string' || typeof saved.libraryKey !== 'string' || typeof saved.name !== 'string') throw new Error('Invalid session')
      credentials = saved
      revision++
      publish({ signedIn: true, name: saved.name, avatarUrl: saved.avatarUrl, persistent: true })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') publish({ error: 'Your saved YouTube session could not be restored. Sign in again.' })
  }
  await activateCurrentLibrary()
}

// Validate against an authenticated endpoint before accepting any cookie jar.
// Never expose cookies to the preload or renderer, data export, or logs.
export async function connectYoutubeAccount(cookie: string): Promise<YoutubeAccountState> {
  const candidate = await createClient(cookie)
  let selected: YoutubeIdentity | null = null
  const probes = [
    { endpoint: '/account/accounts_list', arguments: { requestType: 'ACCOUNTS_LIST_REQUEST_TYPE_CHANNEL_SWITCHER', callCircumstance: 'SWITCHING_USERS_FULL', client: 'WEB' } },
    { endpoint: '/account/account_menu', arguments: { client: 'WEB' } },
    { endpoint: '/account/accounts_list', arguments: { client: 'TV' } }
  ]
  for (const probe of probes) {
    try {
      const response = await candidate.actions.execute(probe.endpoint, probe.arguments)
      const inspected = inspectAccountResponse(response.data)
      console.info('[account] Verification response', { endpoint: probe.endpoint, items: inspected.items, selected: inspected.selected, headers: inspected.headers })
      if (inspected.identity) { selected = inspected.identity; break }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      console.warn('[account] Verification request failed', probe.endpoint, message)
      if (/status(?: code)? 401\b/i.test(message)) throw new Error('This YouTube session has expired. Sign in with your browser or export fresh YouTube cookies.')
      if (/net::|fetch failed|timed? ?out|aborted/i.test(message)) throw new Error('YouTube could not be reached. Check your connection and try again; your existing account was not changed.')
    }
  }
  if (!selected) throw new Error('YouTube did not identify an active account in this session. Try browser sign-in, or export fresh cookies from the YouTube account you want to use.')
  // Handles/bylines are supplied by YouTube, not entered by a local user.
  // For accounts without either, isolate their cache by the session's SID.
  const identity = selected.handle || selected.byline || cookie.match(/(?:^|; )SID=([^;]+)/)?.[1] || createHash('sha256').update(cookie).digest('hex')
  const next: Credentials = {
    cookie, libraryKey: `youtube:${createHash('sha256').update(identity).digest('hex')}`,
    name: selected.name, avatarUrl: selected.avatarUrl
  }
  const persistent = canPersist()
  if (persistent) {
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(`${credentialPath()}.tmp`, safeStorage.encryptString(JSON.stringify(next)), { mode: 0o600 })
    await rename(`${credentialPath()}.tmp`, credentialPath())
  } else {
    await rm(credentialPath(), { force: true })
  }
  await activateLibraryOwner(next.libraryKey, next.name)
  credentials = next
  client = Promise.resolve(candidate)
  playbackClient = null
  clientLanguage = getAppLanguage()
  revision++
  publish({ signedIn: true, name: next.name, avatarUrl: next.avatarUrl, persistent, error: null, syncError: null })
  return youtubeAccountState()
}

export async function disconnectYoutubeAccount(): Promise<YoutubeAccountState> {
  // Local disconnect only: do not revoke the user's Google/browser sessions.
  await rm(credentialPath(), { force: true })
  await activateLibraryOwner('guest', 'Guest')
  credentials = null
  client = null
  playbackClient = null
  revision++
  publish({ signedIn: false, name: null, avatarUrl: null, persistent: false, error: null, syncError: null })
  return youtubeAccountState()
}

export function reportHistorySyncFailure(failed: boolean, expectedRevision: number): void {
  if (revision !== expectedRevision) return
  publish({ syncError: failed ? 'YouTube watch history could not be updated. Your local history is saved. If this continues, sign in again.' : null })
}
