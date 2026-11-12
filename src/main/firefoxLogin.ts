import { app, dialog, type BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { youtubeCookieHeader, type YoutubeCookie } from './youtubeCookies'

let running: { child: ChildProcess; cancelled: boolean } | null = null
let cancelRequested = false

async function firefoxExecutable(owner: BrowserWindow): Promise<string> {
  const candidates = process.platform === 'win32'
    ? [join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Mozilla Firefox/firefox.exe'),
      join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Mozilla Firefox/firefox.exe'),
      join(process.env.LOCALAPPDATA ?? '', 'Mozilla Firefox/firefox.exe')]
    : process.platform === 'darwin' ? ['/Applications/Firefox.app/Contents/MacOS/firefox']
      : ['/usr/bin/firefox', '/usr/bin/firefox-esr', '/opt/firefox/firefox', '/snap/bin/firefox']
  for (const candidate of candidates) {
    try { await access(candidate); return candidate } catch { /* Try next installation. */ }
  }
  const result = await dialog.showOpenDialog(owner, {
    title: 'Choose your Firefox executable (Firefox must be installed)', properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) throw new Error('Firefox sign-in cancelled. Install Firefox or import a YouTube cookies.txt file.')
  return result.filePaths[0]
}

export function cancelFirefoxLogin(): void {
  cancelRequested = true
  if (running) {
    running.cancelled = true
    running.child.kill()
  }
}

export async function signInWithFirefox(owner: BrowserWindow): Promise<string> {
  if (running) throw new Error('A Firefox sign-in is already running')
  cancelRequested = false
  const executable = await firefoxExecutable(owner)
  if (cancelRequested) throw new Error('YouTube sign-in cancelled')
  // A separate ordinary browser profile: no automation protocol, extensions,
  // debugging port or access to the user's existing Firefox profiles.
  const directory = join(app.getPath('userData'), 'browser-signin')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const profile = await mkdtemp(join(directory, 'firefox-'))
  try {
    await writeFile(join(profile, 'user.js'), [
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("browser.startup.homepage_override.mstone", "ignore");',
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
      child.once('error', () => reject(new Error('Unable to start Firefox. Check your Firefox installation.')))
      child.once('exit', (code) => code === 0 || attempt.cancelled ? resolve() : reject(new Error('Firefox exited unexpectedly. Try signing in again.')))
    })
    if (attempt.cancelled) throw new Error('YouTube sign-in cancelled')
    const database = new DatabaseSync(join(profile, 'cookies.sqlite'), { readOnly: true })
    try {
      const rows = database.prepare("SELECT host, name, value, path, expiry FROM moz_cookies WHERE host IN ('.youtube.com', 'youtube.com', 'www.youtube.com', '.www.youtube.com') ORDER BY lastAccessed ASC").all()
      return youtubeCookieHeader(rows as unknown as YoutubeCookie[])
    } finally { database.close() }
  } finally {
    running = null
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function removeAbandonedLoginProfiles(): Promise<void> {
  // This directory contains only this app's temporary sign-in profiles.
  if (!running) await rm(join(app.getPath('userData'), 'browser-signin'), { recursive: true, force: true })
}
