export {
  runConformance,
  formatReport,
  formatReportMarkdown,
  formatBadgeJson,
  ALL_LEVELS,
} from './conformance.js'
export type {
  CheckResult,
  ConformanceLevel,
  ConformanceOptions,
  ConformanceReport,
  FetchLike,
  FixtureGlyphs,
  LevelSummary,
} from './types.js'
export { validators } from './schemas.js'
export {
  FIXTURE_NAMES,
  buildFixtureGlyphs,
  registerFixtures,
} from './fixtures.js'
