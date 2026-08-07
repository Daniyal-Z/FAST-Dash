/**
 * Verifies the browser-side parsers against known-good data.
 *
 * The timetable parser has an exact target: fixtures/timetable-golden.json is
 * the DATA block that was previously hardcoded into Timetable.jsx and shipped
 * to real users. If the parser cannot reproduce it offering-for-offering, the
 * parser is wrong.
 *
 * Run with: npm run verify:parsers
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

import { parseTimetable } from '../src/lib/parsers/timetable.js'
import { parseDatesheet } from '../src/lib/parsers/datesheet.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.resolve(here, '../../fixtures')

const read = (file) => XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: false })

let failures = 0
const fail = (msg) => {
  failures++
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`)
}
const pass = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`)

// ---------------------------------------------------------------- timetable
console.log('\n\x1b[1mTimetable parser vs. golden fixture\x1b[0m')

const golden = JSON.parse(fs.readFileSync(path.join(fixtures, 'timetable-golden.json'), 'utf8'))
const result = parseTimetable(read(path.join(fixtures, 'FSC_F26_TT_v1.0.2_06082026.xlsx')))
const got = result.data

/**
 * Two places where we deliberately differ from the shipped data, because the
 * original one-off extraction got them wrong. They are corrected in the golden
 * copy before comparison so that every *other* difference still fails the run.
 */
const DELIBERATE_DEVIATIONS = [
  'Titles are whitespace-collapsed ("Language  Lab" -> "Language Lab").',
  'MSP-3A is year 2, not year 1: the original extractor\'s programme regex did ' +
    'not allow the space in the "MS (SPM) Fall 2025" heading, so those rows ' +
    'inherited the Fall 2026 batch and were labelled first-year.',
]
for (const o of golden.offerings) {
  o.title = o.title.replace(/\s+/g, ' ').trim()
  o.course = o.course.replace(/\s+/g, ' ').trim()
  if (o.primSection === 'MSP-3A') o.year = 2
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

eq(got.days, golden.days) ? pass('days match') : fail(`days: ${JSON.stringify(got.days)}`)
eq(got.periods, golden.periods)
  ? pass('periods match')
  : fail(`periods differ:\n    got    ${JSON.stringify(got.periods)}\n    golden ${JSON.stringify(golden.periods)}`)

got.offerings.length === golden.offerings.length
  ? pass(`offering count: ${got.offerings.length}`)
  : fail(`offering count: got ${got.offerings.length}, expected ${golden.offerings.length}`)

// Compare by content rather than by id, so a single insertion doesn't cascade
// into 500 false diffs. The id is checked separately via ordering.
const keyOf = (o) =>
  [o.code, o.section, o.prog, o.year, o.bucket, o.instructor, o.course].join('|')

const goldenByKey = new Map()
for (const o of golden.offerings) {
  if (!goldenByKey.has(keyOf(o))) goldenByKey.set(keyOf(o), [])
  goldenByKey.get(keyOf(o)).push(o)
}

const FIELDS = [
  'code', 'course', 'title', 'section', 'primSection',
  'prog', 'year', 'bucket', 'instructor', 'bg', 'text', 'unslotted',
]

const missing = []
const fieldDiffs = new Map()
const extra = []

for (const o of got.offerings) {
  const bucket = goldenByKey.get(keyOf(o))
  if (!bucket || !bucket.length) {
    extra.push(o)
    continue
  }
  const g = bucket.shift()
  for (const f of FIELDS) {
    if (o[f] !== g[f]) {
      const label = `${f}: got ${JSON.stringify(o[f])} · golden ${JSON.stringify(g[f])}`
      if (!fieldDiffs.has(label)) fieldDiffs.set(label, [])
      fieldDiffs.get(label).push(`${g.code} ${g.section}`)
    }
  }
  if (!eq(o.meetings, g.meetings)) {
    const label = `meetings mismatch`
    if (!fieldDiffs.has(label)) fieldDiffs.set(label, [])
    fieldDiffs.get(label).push(
      `${g.code} ${g.section}: got ${JSON.stringify(o.meetings)} golden ${JSON.stringify(g.meetings)}`,
    )
  }
}
for (const [, left] of goldenByKey) missing.push(...left)

missing.length === 0 ? pass('no golden offerings missing') : fail(`${missing.length} golden offerings not produced`)
extra.length === 0 ? pass('no unexpected offerings') : fail(`${extra.length} offerings produced that are not in golden`)
fieldDiffs.size === 0
  ? pass('all fields match on matched offerings')
  : fail(`${fieldDiffs.size} distinct field mismatches`)

if (missing.length) {
  console.log('\n  missing (first 15):')
  for (const o of missing.slice(0, 15)) {
    console.log(`    ${o.id} ${o.code} ${o.section} ${o.prog} y${o.year} ${o.bucket} "${o.course}"`)
  }
}
if (extra.length) {
  console.log('\n  extra (first 15):')
  for (const o of extra.slice(0, 15)) {
    console.log(`    ${o.id} ${o.code} ${o.section} ${o.prog} y${o.year} ${o.bucket} "${o.course}"`)
  }
}
if (fieldDiffs.size) {
  console.log('\n  field mismatches (first 20):')
  for (const [label, where] of [...fieldDiffs].slice(0, 20)) {
    console.log(`    ${label}  ×${where.length}   e.g. ${where[0]}`)
  }
}

const gMeetings = golden.offerings.reduce((n, o) => n + o.meetings.length, 0)
result.stats.meetings === gMeetings
  ? pass(`meeting count: ${gMeetings}`)
  : fail(`meeting count: got ${result.stats.meetings}, expected ${gMeetings}`)

const gUnslotted = golden.offerings.filter((o) => o.unslotted).length
result.stats.unslotted === gUnslotted
  ? pass(`unslotted: ${gUnslotted}`)
  : fail(`unslotted: got ${result.stats.unslotted}, expected ${gUnslotted}`)

const tally = (arr, k) => arr.reduce((a, o) => ((a[o[k]] = (a[o[k]] || 0) + 1), a), {})
for (const k of ['bucket', 'prog', 'year']) {
  const g = tally(golden.offerings, k)
  const t = tally(got.offerings, k)
  eq(t, g) ? pass(`${k} distribution matches`) : fail(`${k}: got ${JSON.stringify(t)} expected ${JSON.stringify(g)}`)
}

console.log('\n  deliberate deviations from the shipped data:')
for (const d of DELIBERATE_DEVIATIONS) console.log(`    · ${d}`)

console.log(`\n  label: "${result.label}"`)
if (result.warnings.length) {
  console.log('  warnings:')
  for (const w of result.warnings.slice(0, 15)) console.log(`    · ${w}`)
}

// ---------------------------------------------------------------- datesheet
console.log('\n\x1b[1mDatesheet parser across all fixture workbooks\x1b[0m')

const dsDir = path.join(fixtures, 'datesheets')
for (const file of fs.readdirSync(dsDir).filter((f) => f.endsWith('.xlsx'))) {
  try {
    const r = parseDatesheet(read(path.join(dsDir, file)))
    const ok = r.data.exams.length > 0 && r.data.slots.length > 0
    const warn = r.warnings.length ? `  \x1b[33m${r.warnings.length} warning(s)\x1b[0m` : ''
    ok
      ? pass(`${file.padEnd(24)} ${String(r.data.exams.length).padStart(4)} exams · ${r.data.slots.length} slots · ${r.data.dates.length} days · "${r.label}"${warn}`)
      : fail(`${file}: parsed but produced no exams`)
    for (const w of r.warnings.slice(0, 3)) console.log(`      · ${w}`)
  } catch (err) {
    fail(`${file}: ${err.message}`)
  }
}

console.log(
  failures === 0
    ? '\n\x1b[32m\x1b[1mAll parser checks passed.\x1b[0m\n'
    : `\n\x1b[31m\x1b[1m${failures} check(s) failed.\x1b[0m\n`,
)
process.exit(failures === 0 ? 0 : 1)
