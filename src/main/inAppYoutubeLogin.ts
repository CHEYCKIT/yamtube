import { app, BrowserWindow, session } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { youtubeCookieHeader, type YoutubeCookie } from './youtubeCookies'
import { connectYoutubeAccount } from './youtubeAccount'
import type { YoutubeAccountState } from '../shared/ipc'

/**
 * An isolated Google sign-in, adapted from Lokal's sign-in approach.
 * Windows uses Edge WebView2, which supports native account/passkey prompts.
 * Other platforms use a sandboxed Electron window. The old external-browser
 * flow remains available if Google refuses embedded sign-in.
 * Cookies never cross into renderer code, logs, or local-data exports.
 */
const YOUTUBE = 'https://www.youtube.com/'
const handoff = new URL('https://www.youtube.com/signin')
handoff.searchParams.set('action_handle_signin', 'true')
handoff.searchParams.set('app', 'desktop')
handoff.searchParams.set('next', YOUTUBE)
const login = new URL('https://accounts.google.com/ServiceLogin')
login.searchParams.set('service', 'youtube')
login.searchParams.set('continue', handoff.toString())
const LOGIN_URL = login.toString()

interface Snapshot { url: string; cookies: YoutubeCookie[] }
interface LoginWindow { read(): Promise<Snapshot>; close(): Promise<void> }
let cancelActive: (() => void) | null = null

export function cancelInAppYoutubeSignIn(): void { cancelActive?.() }

function loginPage(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) return false
    const host = parsed.hostname.toLowerCase()
    return host === 'youtube.com' || host.endsWith('.youtube.com') ||
      host === 'google.com' || host.endsWith('.google.com') ||
      /^accounts\.google\.[a-z.]+$/.test(host)
  } catch { return false }
}

function youtubePage(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && (parsed.hostname === 'www.youtube.com' || parsed.hostname === 'youtube.com')
  } catch { return false }
}

function normalizeCookies(value: unknown): YoutubeCookie[] {
  if (!Array.isArray(value)) return []
  const accepted: YoutubeCookie[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const cookie = item as Record<string, unknown>
    if (typeof cookie.domain !== 'string' || typeof cookie.name !== 'string' ||
        typeof cookie.value !== 'string' || typeof cookie.path !== 'string') continue
    accepted.push({
      host: cookie.domain, name: cookie.name, value: cookie.value, path: cookie.path,
      expiry: cookie.session === true ? 0 :
        typeof cookie.expires === 'number' ? cookie.expires :
        typeof cookie.expirationDate === 'number' ? cookie.expirationDate : 0
    })
  }
  return accepted
}

function openElectronLogin(changed: () => void, closed: () => void): LoginWindow {
  const isolatedSession = session.fromPartition('loktube-youtube-signin-' + randomUUID())
  const window = new BrowserWindow({
    width: 490, height: 790, minWidth: 370, minHeight: 540,
    title: 'Sign in to YouTube — LokTube', autoHideMenuBar: true,
    webPreferences: { session: isolatedSession, sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true }
  })
  window.setMenu(null)
  const contents = window.webContents
  let cleaned = false
  const cookieChanged = () => changed()
  isolatedSession.cookies.on('changed', cookieChanged)
  contents.on('will-navigate', (event, url) => { if (!loginPage(url)) event.preventDefault() })
  contents.on('will-redirect', (event, url) => { if (!loginPage(url)) event.preventDefault() })
  contents.setWindowOpenHandler(({ url }) => {
    if (loginPage(url)) void window.loadURL(url).catch(() => undefined)
    return { action: 'deny' }
  })
  contents.on('did-navigate', changed)
  contents.on('did-navigate-in-page', changed)
  contents.on('did-finish-load', changed)
  window.on('closed', closed)
  void window.loadURL(LOGIN_URL).catch((error: NodeJS.ErrnoException) => {
    // Google's redirects can abort an earlier navigation without failing sign-in.
    if (error.code === 'ERR_ABORTED' || error.errno === -3) return
    if (!window.isDestroyed()) window.destroy()
  })
  return {
    async read() {
      if (window.isDestroyed()) throw new Error('The sign-in window was closed.')
      const cookies = await isolatedSession.cookies.get({ url: YOUTUBE })
      return { url: contents.getURL(), cookies: normalizeCookies(cookies.map(cookie => ({
        ...cookie, expires: cookie.expirationDate ?? 0
      }))) }
    },
    async close() {
      if (cleaned) return
      cleaned = true
      isolatedSession.cookies.removeListener('changed', cookieChanged)
      if (!window.isDestroyed()) window.destroy()
      await isolatedSession.clearStorageData().catch(() => undefined)
    }
  }
}

function helperExecutable(): string {
  return join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'build'),
    'webview2-signin', 'LokTubeSignIn.exe')
}

async function openWebView2Login(changed: () => void, closed: () => void, signal: AbortSignal): Promise<LoginWindow> {
  if (signal.aborted) throw new Error('YouTube sign-in cancelled.')
  const root = join(app.getPath('userData'), 'youtube-signin-profiles')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const profile = await mkdtemp(join(root, 'signin-'))
  const child = spawn(helperExecutable(), ['--profile', profile, '--url', LOGIN_URL], {
    windowsHide: false, stdio: ['pipe', 'pipe', 'ignore']
  })
  type Pending = { resolve: (value: Snapshot) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  const pending = new Map<number, Pending>()
  let nextId = 0
  let started = false
  let exited = false
  let buffer = ''
  let acceptReady: (() => void) | null = null
  let rejectReady: ((error: Error) => void) | null = null
  const ready = new Promise<void>((resolve, reject) => { acceptReady = resolve; rejectReady = reject })
  const startupTimeout = setTimeout(() => rejectReady?.(new Error('The WebView2 sign-in window did not start.')), 30000)
  const abort = () => { rejectReady?.(new Error('YouTube sign-in cancelled.')); child.kill() }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const send = (message: object) => {
    if (!exited && child.stdin.writable) child.stdin.write(JSON.stringify(message) + '\n')
  }
  const stopPending = (reason: string) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error(reason))
    }
    pending.clear()
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    if (buffer.length > 2_000_000) { child.kill(); return }
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const row = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      let data: Record<string, unknown>
      try { data = JSON.parse(row) as Record<string, unknown> } catch { continue }
      if (!data || typeof data !== 'object') continue
      if (data.type === 'ready') {
        started = true
        clearTimeout(startupTimeout)
        acceptReady?.()
        changed()
      } else if (data.type === 'changed') {
        changed()
      } else if (data.type === 'snapshot' && typeof data.id === 'number') {
        const request = pending.get(data.id)
        if (!request) continue
        pending.delete(data.id)
        clearTimeout(request.timer)
        request.resolve({ url: String(data.url || ''), cookies: normalizeCookies(data.cookies) })
      } else if (data.type === 'error') {
        const message = typeof data.message === 'string' ? data.message : 'The WebView2 sign-in failed.'
        if (!started) rejectReady?.(new Error(message))
        else closed()
      }
    }
  })
  child.on('error', (error) => {
    if (!started) rejectReady?.(new Error('Could not launch WebView2: ' + error.message))
    else closed()
  })
  child.on('exit', () => {
    signal.removeEventListener('abort', abort)
    exited = true
    clearTimeout(startupTimeout)
    stopPending('The sign-in window was closed.')
    if (!started) rejectReady?.(new Error('The WebView2 sign-in window closed before it was ready.'))
    else closed()
  })
  try { await ready } catch (error) {
    signal.removeEventListener('abort', abort)
    clearTimeout(startupTimeout)
    child.kill()
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 400 }).catch(() => undefined)
    throw error
  }
  return {
    read() {
      if (exited) return Promise.reject(new Error('The sign-in window was closed.'))
      const id = ++nextId
      return new Promise<Snapshot>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('The WebView2 sign-in window did not respond.')) }, 15000)
        pending.set(id, { resolve, reject, timer })
        send({ cmd: 'read', id })
      })
    },
    async close() {
      if (!exited) {
        send({ cmd: 'close' })
        await new Promise<void>((resolve) => {
          if (exited) { resolve(); return }
          const timer = setTimeout(() => { child.kill(); resolve() }, 3000)
          child.once('exit', () => { clearTimeout(timer); resolve() })
        })
      }
      stopPending('The sign-in window was closed.')
      await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 }).catch(() => undefined)
    }
  }
}

export async function signInYoutubeInApp(): Promise<YoutubeAccountState> {
  if (cancelActive) throw new Error('Another YouTube sign-in is already running.')
  let active = true
  const controller = new AbortController()
  let window: LoginWindow | null = null
  let lastError = ''
  let checking = false
  let attemptedHeader = ''
  let attemptedAt = 0
  let resolveResult!: (state: YoutubeAccountState) => void
  let rejectResult!: (error: Error) => void
  const result = new Promise<YoutubeAccountState>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
  // Closing the window before it opens may reject while opening is still pending.
  void result.catch(() => undefined)
  const fail = (error: Error) => { if (active) { active = false; rejectResult(error) } }
  const finish = (state: YoutubeAccountState) => { if (active) { active = false; resolveResult(state) } }
  const closed = () => fail(new Error(lastError ||
    'YouTube sign-in was not completed. Use the external browser option if Google blocks this window.'))
  cancelActive = () => { controller.abort(); fail(new Error('YouTube sign-in cancelled.')) }

  const verify = async () => {
    if (!active || !window || checking) return
    checking = true
    try {
      const snapshot = await window.read()
      if (!active || !youtubePage(snapshot.url)) return
      let header: string
      try { header = youtubeCookieHeader(snapshot.cookies) } catch { return }
      if (header === attemptedHeader && Date.now() - attemptedAt < 7000) return
      attemptedHeader = header
      attemptedAt = Date.now()
      try {
        const account = await connectYoutubeAccount(header, () => active)
        finish(account)
      } catch (error) {
        if (active) lastError = error instanceof Error ? error.message : String(error)
      }
    } catch (error) {
      if (active) lastError = error instanceof Error ? error.message : String(error)
    } finally {
      checking = false
    }
  }

  try {
    const changed = () => { void verify() }
    window = process.platform === 'win32' && existsSync(helperExecutable())
      ? await openWebView2Login(changed, closed, controller.signal)
      : openElectronLogin(changed, closed)
    const polling = setInterval(() => { void verify() }, 2000)
    try {
      await verify()
      return await result
    } finally { clearInterval(polling) }
  } finally {
    active = false
    cancelActive = null
    await window?.close()
  }
}
