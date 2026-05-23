export { runInspect, formatOverview, formatCard } from './commands/inspect.js'
export { runVerify } from './commands/verify.js'
export type { VerifyResult } from './commands/verify.js'
export { runDiffCard, formatDiff } from './commands/diff.js'
export type { DiffResult } from './commands/diff.js'
export {
  runPinsList,
  runPinsApprove,
  runPinsRevoke,
} from './commands/pins.js'
export type { PinsResult } from './commands/pins.js'
export { runManifestVerify } from './commands/manifest.js'
export type { ManifestResult } from './commands/manifest.js'
export { runInit } from './commands/init.js'
