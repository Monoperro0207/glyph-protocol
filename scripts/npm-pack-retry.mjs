// Usage: node scripts/npm-pack-retry.mjs <name@version>
//
// `npm publish` returns before the registry serves the new version, so an
// `npm pack name@version` run right after a release can 404 for a minute or
// more. Retry until the tarball is fetchable, then print its filename on
// stdout exactly like `npm pack --silent` does.
import { execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const spec = process.argv[2]
if (!spec) throw new Error('usage: npm-pack-retry.mjs <name@version>')

const attempts = Number(process.env.NPM_PACK_ATTEMPTS ?? 20)
const delaySeconds = Number(process.env.NPM_PACK_DELAY_SECONDS ?? 30)

for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    const tarball = execFileSync('npm', ['pack', spec, '--silent'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }).trim()
    process.stdout.write(`${tarball}\n`)
    process.exit(0)
  } catch {
    if (attempt === attempts) break
    console.error(
      `npm pack ${spec}: not available yet (attempt ${attempt}/${attempts}), retrying in ${delaySeconds}s`,
    )
    await sleep(delaySeconds * 1000)
  }
}

console.error(`npm pack ${spec}: failed after ${attempts} attempts`)
process.exit(1)
