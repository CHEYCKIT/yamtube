import { app, dialog, type BrowserWindow } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { youtubeCookieHeader, type YoutubeCookie } from './youtubeCookies'
import { browserCandidates, browserFromExecutable, registryBrowserExecutables, type SignInBrowser } from './browserDiscovery'
import type { SignInBrowserState } from '../shared/ipc'

let running: { child: ChildProcess; cancelled: boolean } | null = null
let cancelRequested = false

interface BrowserSettings { selectedId: string | null; customPaths: string[] }
let detected: SignInBrowser[] | null = null
const settingsPath = () => join(app.getPath('userData'), 'browser-signin-settings.json')
async function settings(): Promise<BrowserSettings> {
  try {
    const value = JSON.parse(await readFile(settingsPath(), 'utf8'))
    return { selectedId: typeof value.selectedId === 'string' ? value.selectedId : null,
      customPaths: Array.isArray(value.customPaths) ? value.customPaths.filter((path: unknown): path is string => typeof path === 'string').slice(0, 20) : [] }
  } catch { return { selectedId: null, customPaths: [] } }
}
async function saveSettings(value: BrowserSettings): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(value), { mode: 0o600 })
}
async function registeredBrowsers(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const run = promisify(execFile)
  const results = await Promise.allSettled(['HKCU', 'HKLM'].flatMap((hive) => [
    `${hive}\\Software\\Clients\\StartMenuInternet`,
    `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths`
  ]).map((key) => run('reg.exe', ['query', key, '/s'], { windowsHide: true, timeout: 3000, maxBuffer: 2 * 1024 * 1024 })))
  return results.flatMap((result) => result.status === 'fulfilled' ? registryBrowserExecutables(result.value.stdout) : [])
    .map((path) => path.replace(/%([^%]+)%/g, (original, name: string) => process.env[name] ?? original))
}
async function available(browser: SignInBrowser): Promise<boolean> {
  try {
    if (!(await stat(browser.executable)).isFile()) return false
    await access(browser.executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch { return false }
}
async function browsers(refresh = false): Promise<SignInBrowser[]> {
  if (refresh || !detected) {
    const saved = await settings()
    const candidates = browserCandidates(process.platform, process.env, homedir(), [...saved.customPaths, ...await registeredBrowsers()])
    const present = await Promise.all(candidates.map(available))
    detected = candidates.filter((_, index) => present[index]).sort((a, b) => Number(b.name === 'Zen') - Number(a.name === 'Zen') || a.name.localeCompare(b.name))
  }
  return detected
}
export async function getSignInBrowsers(refresh = false): Promise<SignInBrowserState> {
  const choices = await browsers(refresh)
  const saved = await settings()
  return { browsers: choices.map(({ id, name }) => ({ id, name })),
    selectedId: choices.some(({ id }) => id === saved.selectedId) ? saved.selectedId : choices[0]?.id ?? null }
}
export async function selectSignInBrowser(id: string): Promise<SignInBrowserState> {
  if (typeof id !== 'string' || !(await browsers()).some((browser) => browser.id === id)) throw new Error('Choose an installed sign-in browser.')
  await saveSettings({ ...await settings(), selectedId: id })
  return getSignInBrowsers()
}
export async function addSignInBrowser(owner: BrowserWindow): Promise<SignInBrowserState> {
  const result = await dialog.showOpenDialog(owner, {
    title: 'Add Zen, Firefox, LibreWolf, Waterfox or Floorp', properties: ['openFile'],
    ...(process.platform === 'win32' ? { filters: [{ name: 'Browser application', extensions: ['exe'] }] } : {})
  })
  if (result.canceled || !result.filePaths[0]) return getSignInBrowsers()
  let executable = result.filePaths[0]
  if (process.platform === 'darwin' && executable.endsWith('.app')) {
    const bundle = executable.split('/').at(-1)!.toLowerCase()
    const binary = bundle.startsWith('firefox') ? 'firefox' : bundle.slice(0, -4)
    executable = join(executable, 'Contents/MacOS', binary)
  }
  const browser = browserFromExecutable(executable, process.platform)
  if (!browser || !await available(browser)) throw new Error('Choose a Zen, Firefox, LibreWolf, Waterfox or Floorp application. You can import YouTube cookies from other browsers.')
  const saved = await settings()
  await saveSettings({ selectedId: browser.id, customPaths: [...new Set([...saved.customPaths, executable])].slice(-20) })
  return getSignInBrowsers(true)
}

export function cancelBrowserLogin(): void {
  cancelRequested = true
  if (running) {
    running.cancelled = true
    const child = running.child
    // Firefox-family Windows launchers may wait on a separate browser process.
    // Terminate only our isolated sign-in process tree, including that child.
    if (process.platform === 'win32' && child.pid) {
      execFile('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, (error) => { if (error) child.kill() })
    } else child.kill()
  }
}

export async function signInWithBrowser(id?: string): Promise<string> {
  if (running) throw new Error('A browser sign-in is already running')
  cancelRequested = false
  const state = await getSignInBrowsers(true)
  const browser = (await browsers()).find((choice) => choice.id === (id ?? state.selectedId))
  if (!browser) throw new Error('No supported sign-in browser was found. Install Zen or Firefox, add a portable browser, or import YouTube cookies.')
  await selectSignInBrowser(browser.id)
  const { executable, name } = browser
  if (cancelRequested) throw new Error('YouTube sign-in cancelled')
  // A separate ordinary browser profile: no automation protocol, extensions,
  // debugging port or access to the user's existing browser profiles.
  const directory = join(app.getPath('userData'), 'browser-signin')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const profile = await mkdtemp(join(directory, 'signin-'))
  try {
    await writeFile(join(profile, 'user.js'), [
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("browser.startup.homepage_override.mstone", "ignore");',
      'user_pref("browser.aboutwelcome.enabled", false);',
      'user_pref("zen.welcome-screen.seen", true);',
      'user_pref("browser.sessionstore.resume_from_crash", false);',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      'user_pref("toolkit.telemetry.enabled", false);'
    ].join('\n'), { mode: 0o600 })
    if (cancelRequested) throw new Error('YouTube sign-in cancelled')
    const child = spawn(executable, [...(process.platform === 'win32' ? ['-wait-for-browser'] : []),
      '--no-remote', '--profile', profile, 'https://www.youtube.com/'], {
      stdio: 'ignore', windowsHide: false
    })
    const attempt = { child, cancelled: false }
    running = attempt
    await new Promise<void>((resolve, reject) => {
      child.once('error', () => reject(new Error(`Unable to start ${name}. Check the browser installation or choose another browser.`)))
      child.once('exit', (code) => code === 0 || attempt.cancelled ? resolve() : reject(new Error(`${name} exited unexpectedly. Try signing in again.`)))
    })
    if (attempt.cancelled) throw new Error('YouTube sign-in cancelled')
    try { await access(join(profile, 'cookies.sqlite')) } catch { throw new Error(`No YouTube session was saved. Finish signing in on youtube.com in ${name}, then close that sign-in window.`) }
    const database = new DatabaseSync(join(profile, 'cookies.sqlite'), { readOnly: true })
    try {
      const rows = database.prepare("SELECT host, name, value, path, expiry FROM moz_cookies WHERE host IN ('.youtube.com', 'youtube.com', 'www.youtube.com', '.www.youtube.com') ORDER BY lastAccessed ASC").all()
      return youtubeCookieHeader(rows as unknown as YoutubeCookie[])
    } finally { database.close() }
  } finally {
    running = null
    await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }).catch(() => undefined)
  }
}

export async function removeAbandonedLoginProfiles(): Promise<void> {
  // This directory contains only this app's temporary sign-in profiles.
  if (!running) await rm(join(app.getPath('userData'), 'browser-signin'), { recursive: true, force: true })
}
