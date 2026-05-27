import { readFile } from 'node:fs/promises'

const GO_MOD_PATH = new URL('../sdks/go/glyphprotocol/go.mod', import.meta.url)
const CI_PATH = new URL('../.github/workflows/ci.yml', import.meta.url)

function parseGoVersion(text) {
  const match = text.match(/^go\s+(\d+)\.(\d+)(?:\.\d+)?$/m)
  if (!match) throw new Error('go.mod is missing a go directive')
  return { major: Number(match[1]), minor: Number(match[2]) }
}

function parseCiGoVersion(text) {
  const match = text.match(/go-version:\s*['"]?(\d+)\.(\d+)['"]?/)
  if (!match) throw new Error('CI workflow is missing actions/setup-go go-version')
  return { major: Number(match[1]), minor: Number(match[2]) }
}

function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major
  return a.minor - b.minor
}

const [goMod, ci] = await Promise.all([readFile(GO_MOD_PATH, 'utf8'), readFile(CI_PATH, 'utf8')])

const moduleGo = parseGoVersion(goMod)
const ciGo = parseCiGoVersion(ci)

if (compareVersions(moduleGo, ciGo) > 0) {
  throw new Error(
    `Go SDK go.mod requires ${moduleGo.major}.${moduleGo.minor}, but CI uses ${ciGo.major}.${ciGo.minor}`,
  )
}
