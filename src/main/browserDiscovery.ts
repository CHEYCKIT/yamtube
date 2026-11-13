import { createHash } from 'node:crypto'
import { posix, win32 } from 'node:path'

export interface SignInBrowser { id: string; name: string; executable: string }
const names: Record<string, string> = { zen: 'Zen', 'zen-browser': 'Zen', firefox: 'Firefox', 'firefox-esr': 'Firefox', librewolf: 'LibreWolf', waterfox: 'Waterfox', floorp: 'Floorp' }

export function browserFromExecutable(executable: string, platform: string): SignInBrowser | null {
  const file = (platform === 'win32' ? win32.basename(executable) : posix.basename(executable)).replace(/\.exe$/i, '').toLowerCase()
  const name = Object.hasOwn(names, file) ? names[file] : null
  if (!name) return null
  const key = platform === 'win32' ? executable.toLowerCase() : executable
  return { id: createHash('sha256').update(key).digest('hex').slice(0, 24), name, executable }
}

export function registryBrowserExecutables(output: string): string[] {
  const paths: string[] = []
  for (const line of output.split(/\r?\n/)) {
    const data = line.match(/\bREG_(?:EXPAND_)?SZ\s+(.+)$/i)?.[1]?.trim()
    if (!data) continue
    const candidate = data.match(/^"([^"]+\.exe)"/i)?.[1] ?? data.match(/^((?:[A-Za-z]:\\|%[^%]+%\\).*?\.exe)(?:\s|$)/i)?.[1]
    if (candidate && browserFromExecutable(candidate, 'win32')) paths.push(candidate)
  }
  return paths
}

export function browserCandidates(platform: string, env: Record<string, string | undefined>, home: string, registered: string[] = []): SignInBrowser[] {
  let paths = [...registered]
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES ?? 'C:\\Program Files', env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', env.LOCALAPPDATA, env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs')].filter((path): path is string => !!path)
    for (const root of roots) for (const [folder, file] of [
      ['Zen Browser', 'zen.exe'], ['Zen Browser (Twilight)', 'zen.exe'], ['Zen', 'zen.exe'],
      ['Mozilla Firefox', 'firefox.exe'], ['Firefox Developer Edition', 'firefox.exe'], ['LibreWolf', 'librewolf.exe'], ['Waterfox', 'waterfox.exe'], ['Floorp', 'floorp.exe']
    ]) paths.push(win32.join(root, folder, file))
  } else if (platform === 'darwin') {
    for (const root of ['/Applications', posix.join(home, 'Applications')]) for (const [bundle, file] of [
      ['Zen.app', 'zen'], ['Firefox.app', 'firefox'], ['Firefox Developer Edition.app', 'firefox'], ['LibreWolf.app', 'librewolf'], ['Waterfox.app', 'waterfox'], ['Floorp.app', 'floorp']
    ]) paths.push(posix.join(root, bundle, 'Contents/MacOS', file))
  } else {
    paths.push('/opt/zen/zen', '/opt/zen-browser/zen', posix.join(home, '.local/share/zen/zen'))
    for (const root of [...(env.PATH ?? '/usr/bin:/usr/local/bin').split(':'), posix.join(home, '.local/bin')]) {
      for (const file of Object.keys(names)) paths.push(posix.join(root, file))
    }
    paths.push('/opt/firefox/firefox', '/snap/bin/firefox')
  }
  const seen = new Set<string>()
  return paths.flatMap((path) => {
    const browser = browserFromExecutable(path, platform)
    if (!browser || seen.has(browser.id)) return []
    seen.add(browser.id)
    return [browser]
  })
}
