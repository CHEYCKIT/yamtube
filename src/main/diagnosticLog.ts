import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { formatWithOptions } from 'node:util'

export function redactDiagnostics(message: string): string {
  const fields = '(?:cookie|set-cookie|authorization|x-goog-authuser|x-goog-pageid|po[_-]?token|visitor[_-]?data|visitorData|SAPISID|HSID|SSID|SID|APISID|LOGIN_INFO|access[_-]?token|refresh[_-]?token|__Secure-[A-Za-z0-9_-]+)'
  return message
    .replace(new RegExp(`(["']?${fields}["']?\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\r\\n,;}]+)`, 'gi'), '$1[redacted]')
    .replace(/\b(?:SAPISID(?:1P|3P)?HASH|Bearer)\s+[\w.~+\/-]+/gi, '[redacted authorization]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[redacted token]')
    .replace(/https?:\/\/[^\s<>"']+/gi, (text) => {
      try {
        const url = new URL(text)
        const path = url.pathname.startsWith('/api/manifest/') ? '/api/manifest/[redacted]' : url.pathname
        return url.origin + path
      } catch { return '[redacted URL]' }
    })
}

let directory = ''
let pending: Promise<void> = Promise.resolve()
let bytes = 0
let initialized = false
const MAX_FILE_BYTES = 512 * 1024
const MAX_VIEW_BYTES = 128 * 1024
const logPath = () => join(directory, 'yamtube.log')

export async function initializeDiagnostics(path: string): Promise<void> {
  if (initialized) return
  directory = path
  await mkdir(directory, { recursive: true, mode: 0o700 })
  bytes = await stat(logPath()).then((file) => file.size).catch(() => 0)
  initialized = true
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      const message = redactDiagnostics(formatWithOptions({ depth: 5, maxStringLength: 6000, breakLength: Infinity, colors: false }, ...args)).slice(0, 24_000)
      original(message)
      const line = `${new Date().toISOString()} [${level}] ${message}\n`
      pending = pending.then(async () => {
        if (bytes + Buffer.byteLength(line) > MAX_FILE_BYTES) {
          await rename(`${logPath()}.1`, `${logPath()}.2`).catch(() => undefined)
          await rename(logPath(), `${logPath()}.1`).catch(() => undefined)
          bytes = 0
        }
        await appendFile(logPath(), line, { mode: 0o600 })
        bytes += Buffer.byteLength(line)
      }).catch(() => undefined)
    }
  }
}

export async function getDiagnostics(includeAll = false): Promise<{ path: string; contents: string }> {
  await pending
  const chunks = await Promise.all([`${logPath()}.2`, `${logPath()}.1`, logPath()].map((file) => readFile(file, 'utf8').catch(() => '')))
  const contents = chunks.join('')
  return { path: logPath(), contents: includeAll ? contents : contents.slice(-MAX_VIEW_BYTES) }
}
