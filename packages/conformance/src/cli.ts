#!/usr/bin/env node
import { runConformance, formatReport } from './conformance.js'

const baseUrl = process.argv[2]

if (!baseUrl || baseUrl === '--help' || baseUrl === '-h') {
  console.error('usage: glyph-conformance <baseUrl>')
  console.error('example: glyph-conformance http://localhost:3100')
  process.exit(baseUrl ? 0 : 2)
}

const report = await runConformance(baseUrl)
console.log(formatReport(report))
process.exit(report.passed ? 0 : 1)
