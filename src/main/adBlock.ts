import { app, net, session, type Session } from 'electron'
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { RequestPolicy, redirectHeaders, scopedCredentialHeaders } from './requestPolicy'
import type { ProtectionState } from '../shared/ipc'

let policy: RequestPolicy
let updatedAt: string
let updating: Promise<ProtectionState> | null = null
const installed = new WeakSet<Session>()
const lists = ['easylist', 'easyprivacy'] as const
const cachePath = () => join(app.getPath('userData'), 'adblock-filters.json')

export async function initializeProtection(): Promise<void> {
  const directory = app.isPackaged ? join(process.resourcesPath, 'filters') : join(app.getAppPath(), 'resources/filters')
  const bundled = await Promise.all(lists.map((name) => readFile(join(directory, `${name}.txt`), 'utf8')))
  let filters = bundled.join('\n')
  updatedAt = filters.match(/! Last modified: (.+)/)?.[1] ?? 'bundled'
  try {
    const cached = JSON.parse(await readFile(cachePath(), 'utf8'))
    if (typeof cached.filters === 'string' && cached.filters.length > 100_000 && typeof cached.updatedAt === 'string') {
      filters = cached.filters
      updatedAt = cached.updatedAt
    }
  } catch { /* Bundled filters work offline on the first launch. */ }
  policy = new RequestPolicy(filters)
  app.on('session-created', installProtection)
  installProtection(session.defaultSession)
  const refreshIfStale = () => {
    const age = Date.now() - Date.parse(updatedAt)
    if (!Number.isFinite(age) || age > 4 * 24 * 60 * 60_000) {
      void updateProtection().catch(() => console.warn('[protection] Filter refresh unavailable; keeping installed lists'))
    }
  }
  refreshIfStale()
  setInterval(refreshIfStale, 12 * 60 * 60_000).unref()
}

export function installProtection(target: Session): void {
  if (installed.has(target)) return
  installed.add(target)
  target.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    callback({ cancel: policy.blocks(details.url, details.resourceType, details.referrer || 'https://www.youtube.com/') })
  })
}

export function protectionState(): ProtectionState {
  return { enabled: true, blocked: policy?.blocked ?? 0, updatedAt, lists: ['EasyList', 'EasyPrivacy'] }
}

// All InnerTube requests use this path, including background browse and stats.
// Use Electron's transport for OS proxy/certificate support; filtering itself
// is the engine-independent Ghostery library, with no browser extension.
export async function protectedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  let request = new Request(input, init)
  request = new Request(request, { headers: scopedCredentialHeaders(request.headers, new URL(request.url)) })
  // Bound every operation, including remote APIs that never send a response.
  const signal = request.signal
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (policy.blocks(request.url)) throw new Error('Request blocked by ad and tracking protection')
    const replayBody = !['GET', 'HEAD'].includes(request.method) ? await request.clone().arrayBuffer() : undefined
    const response = await net.fetch(request, { redirect: 'manual', credentials: 'omit', signal: bounded })
    if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.has('location')) return response
    if (request.redirect === 'error') throw new Error('Unexpected redirect')
    if (request.redirect === 'manual') return response
    if (redirects === 5) throw new Error('Too many redirects')
    const previous = new URL(request.url)
    const next = new URL(response.headers.get('location')!, previous)
    if (next.protocol !== 'https:') throw new Error('Insecure redirect refused')
    const useGet = response.status === 303 || ([301, 302].includes(response.status) && request.method === 'POST')
    const headers = redirectHeaders(request.headers, previous, next)
    if (useGet) {
      headers.delete('content-type')
      headers.delete('content-length')
    }
    const body = useGet ? undefined : replayBody
    await response.body?.cancel()
    request = new Request(next, { method: useGet ? 'GET' : request.method, headers, body, signal: bounded })
  }
  throw new Error('Too many redirects')
}

export function updateProtection(): Promise<ProtectionState> {
  if (updating) return updating
  updating = (async () => {
    const contents = await Promise.all(lists.map(async (name) => {
      const response = await net.fetch(`https://easylist.to/easylist/${name}.txt`, {
        credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30_000)
      })
      if (!response.ok) throw new Error(`Filter download failed (${response.status})`)
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Empty filter response')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 8 * 1024 * 1024) throw new Error('Filter download too large')
          chunks.push(value)
        }
      } finally { await reader.cancel() }
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text.startsWith('[Adblock Plus') || text.length < 100_000) throw new Error('Invalid filter list')
      return text
    }))
    const filters = contents.join('\n')
    const next = new RequestPolicy(filters)
    const timestamp = new Date().toISOString()
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(`${cachePath()}.tmp`, JSON.stringify({ filters, updatedAt: timestamp }), { mode: 0o600 })
    await rename(`${cachePath()}.tmp`, cachePath())
    next.blocked = policy.blocked
    policy = next
    updatedAt = timestamp
    return protectionState()
  })().finally(() => { updating = null })
  return updating
}
