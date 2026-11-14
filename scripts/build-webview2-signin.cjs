// Build the first-party Edge WebView2 sign-in helper for Windows installers.
const { spawnSync } = require('node:child_process')
const { existsSync, mkdirSync, readdirSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')

if (process.platform === 'win32') {
  const root = resolve(__dirname, '..')
  const project = join(root, 'tools', 'webview2-signin', 'LokTubeSignIn.csproj')
  const output = join(root, 'build', 'webview2-signin')
  const sdk = spawnSync('dotnet', ['--version'], { encoding: 'utf8', windowsHide: true })
  if (sdk.error || sdk.status !== 0) throw new Error('The .NET SDK is required to build LokTube’s WebView2 sign-in helper.')
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  const build = spawnSync('dotnet', ['build', project, '-c', 'Release', '-o', output, '-nologo'],
    { cwd: root, stdio: 'inherit', windowsHide: true })
  if (build.error || build.status !== 0 || !existsSync(join(output, 'LokTubeSignIn.exe')))
    throw new Error('The WebView2 sign-in helper could not be built.')
  for (const file of readdirSync(output)) if (/\.pdb$/i.test(file)) rmSync(join(output, file))
  console.log('WebView2 sign-in helper ready.')
}
