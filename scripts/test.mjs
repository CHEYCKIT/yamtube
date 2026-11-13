import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
await mkdir('.cache/tests', { recursive: true })
await build({ entryPoints: ['tests/core.test.ts'], outfile: '.cache/tests/core.test.mjs', bundle: true,
  platform: 'node', format: 'esm', packages: 'external', target: 'node24' })
const result = spawnSync(process.execPath, ['--test', '.cache/tests/core.test.mjs'], { stdio: 'inherit' })
process.exitCode = result.status ?? 1
