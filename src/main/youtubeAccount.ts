import { app, BrowserWindow, safeStorage } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Innertube, YTNodes } from 'youtubei.js'
import { protectedFetch } from './adBlock'
import { IPC_CHANNELS, type YoutubeAccountState } from '../shared/ipc'
import { activateLibraryOwner } from './localDb'

interface Credentials {
  cookie: string
  libraryKey: string
  name: string
  avatarUrl: string | null
}

let credentials: Credentials | null = null
let client: Promise<Innertube> | null = null
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

function createClient(cookie?: string): Promise<Innertube> {
  return Innertube.create({ cookie, generate_session_locally: true, retrieve_player: false, retrieve_innertube_config: false, fetch: protectedFetch })
}

export function getAccountClient(): Promise<Innertube> {
  if (!client) {
    const pending = createClient(credentials?.cookie).catch((error) => {
      if (client === pending) client = null
      throw error
    })
    client = pending
  }
  return client
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
  let accounts: InstanceType<typeof YTNodes.AccountItem>[]
  try { accounts = await candidate.account.getInfo(true) }
  catch { throw new Error('YouTube could not verify this session. Sign in to YouTube again and retry.') }
  const selected = accounts.find((account) => account.is_selected && !account.is_disabled)
  if (!selected) throw new Error('YouTube did not return an active account. Finish signing in to YouTube and retry.')
  // Handles/bylines are supplied by YouTube, not entered by a local user.
  // For accounts without either, isolate their cache by the session's SID.
  const identity = selected.channel_handle.text?.trim() || selected.account_byline.text?.trim() || cookie.match(/(?:^|; )SID=([^;]+)/)?.[1]
  if (!identity) throw new Error('YouTube did not return an account identity')
  const next: Credentials = {
    cookie, libraryKey: `youtube:${createHash('sha256').update(identity).digest('hex')}`,
    name: selected.account_name.text?.trim() || 'YouTube account', avatarUrl: selected.account_photo[0]?.url ?? null
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
  revision++
  publish({ signedIn: false, name: null, avatarUrl: null, persistent: false, error: null, syncError: null })
  return youtubeAccountState()
}

export function reportHistorySyncFailure(failed: boolean, expectedRevision: number): void {
  if (revision !== expectedRevision) return
  publish({ syncError: failed ? 'YouTube watch history could not be updated. Your local history is saved. If this continues, sign in again.' : null })
}
