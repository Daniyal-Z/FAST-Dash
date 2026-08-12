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

// The academic year is now worked out from the clock, so the parse has to be
// given a fixed one. Without this these checks would start failing by
// themselves next August, which is the least useful kind of failing test.
// Both timetable fixtures are Fall 2026 sheets.
const DURING_FALL_2026 = new Date('2026-09-15T00:00:00Z')
const parseAt = (file, now = DURING_FALL_2026) => parseTimetable(read(file), { now })

let failures = 0
const fail = (msg) => {
  failures++
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`)
}
const pass = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`)

// ---------------------------------------------------------------- timetable
console.log('\n\x1b[1mTimetable parser vs. golden fixture\x1b[0m')

const golden = JSON.parse(fs.readFileSync(path.join(fixtures, 'timetable-golden.json'), 'utf8'))
const result = parseAt(path.join(fixtures, 'FSC_F26_TT_v1.0.2_06082026.xlsx'))
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
  [o.code, o.section, o.prog, o.year, o.bucket, o.course].join('|')

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
let recoveredNames = 0

for (const o of got.offerings) {
  const bucket = goldenByKey.get(keyOf(o))
  if (!bucket || !bucket.length) {
    extra.push(o)
    continue
  }
  const g = bucket.shift()
  for (const f of FIELDS) {
    if (o[f] === g[f]) continue
    // The original extraction read only the short-name column, so a course
    // with just a full name was labelled TBA. Filling that in is intended.
    if (f === 'instructor' && g.instructor === 'TBA' && o.instructor !== 'TBA') {
      recoveredNames++
      continue
    }
    {
      const label = `${f}: got ${JSON.stringify(o[f])} · golden ${JSON.stringify(g[f])}`
      if (!fieldDiffs.has(label)) fieldDiffs.set(label, [])
      fieldDiffs.get(label).push(`${g.code} ${g.section}`)
    }
  }
  // The golden copy predates start/end/duration/span, so compare only the
  // fields it actually has. Spans are asserted separately below.
  const core = (ms) => ms.map(({ day, period, time, room }) => ({ day, period, time, room }))
  if (!eq(core(o.meetings), g.meetings)) {
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
recoveredNames > 0 &&
  pass(`${recoveredNames} offerings labelled TBA in the shipped data now name their teacher`)
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

/* -------------------------------------------------- multi-period spanning */
console.log('\n\x1b[1mClasses that outrun their starting slot\x1b[0m')

const allMeetings = got.offerings.flatMap((o) => o.meetings.map((m) => ({ o, m })))
const spanned = allMeetings.filter(({ m }) => m.span > 1)

// Band length is 90 minutes; anything longer has to cover more than one band.
const wrongSpan = allMeetings.filter(({ m }) => {
  if (!m.duration) return m.span !== 1
  const [h, mm] = m.start.split(':').map(Number)
  const startMins = h * 60 + mm
  const end = startMins + m.duration
  const expected = got.periods.filter((p) => {
    const [from, to] = p.t.split('-').map((t) => {
      const [ph, pm] = t.split(':').map(Number)
      return ph * 60 + pm
    })
    return from < end && to > startMins
  }).length
  return m.span !== Math.max(1, expected)
})

wrongSpan.length === 0
  ? pass('every span matches the class duration')
  : fail(`${wrongSpan.length} meetings have a span that does not match their duration`)

spanned.length > 0
  ? pass(`${spanned.length} meetings span more than one slot`)
  : fail('no multi-slot meetings found — the duration column is not being read')

const noDuration = allMeetings.filter(({ m }) => !m.duration).length
console.log(`      \x1b[2m${allMeetings.length - noDuration} of ${allMeetings.length} meetings have a duration; ${noDuration} do not\x1b[0m`)
for (const { o, m } of spanned.slice(0, 3)) {
  console.log(`      \x1b[2m${o.code} ${o.course} · ${m.day} ${m.start}-${m.end} (${m.duration}min) → periods ${m.period}..${m.period + m.span - 1}\x1b[0m`)
}

/* ------------------------------------------------- year / semester sanity */
//
// Every timetable workbook, not just the golden one. An undergraduate section
// carries its own year in its name — BCS-3A is a second year — so the year the
// parser derives from the batch heading must agree with it. When it does not,
// the whole timetable has shifted: v1.0.4 of the Fall 2026 sheet was headed
// "Fall 2025", which slid every batch down a year and merged two of them into
// year 1. This is the check that catches that.
console.log('\n\x1b[1mYear assignment across every timetable workbook\x1b[0m')

const timetableFiles = fs
  .readdirSync(fixtures)
  .filter((f) => f.endsWith('.xlsx'))
  .sort()

for (const file of timetableFiles) {
  const parsed = parseAt(path.join(fixtures, file))

  // year -> the set of undergraduate semesters filed under it
  const semsByYear = new Map()
  for (const o of parsed.data.offerings) {
    if (!o.primSection || !o.prog.startsWith('B')) continue
    const m = /^[A-Za-z]{3}-(\d)/.exec(o.primSection)
    if (!m) continue
    if (!semsByYear.has(o.year)) semsByYear.set(o.year, new Set())
    semsByYear.get(o.year).add(Number(m[1]))
  }

  const wrong = []
  for (const [year, sems] of semsByYear) {
    for (const sem of sems) if (Math.ceil(sem / 2) !== year) wrong.push(`year ${year} holds semester ${sem}`)
  }

  wrong.length === 0
    ? pass(`${file.padEnd(34)} each year holds exactly its own semester`)
    : fail(`${file}: ${wrong.slice(0, 4).join('; ')}`)

  const shifted = parsed.warnings.find((w) => w.includes('newest batch'))
  if (shifted) console.log(`      \x1b[33m! ${shifted}\x1b[0m`)
}

/* --------------------------------------------------------- teacher names */
const named = got.offerings.filter((o) => o.instructorFull && o.instructorFull !== 'TBA')
const fuller = named.filter((o) => o.instructorFull !== o.instructor)

named.length > 0
  ? pass(`full teacher names on ${named.length} offerings (${fuller.length} longer than the short form)`)
  : fail('no full teacher names read — check the "Instructor Name" column')

console.log(`      \x1b[2me.g. ${fuller.slice(0, 3).map((o) => `${o.instructor} -> ${o.instructorFull}`).join('; ')}\x1b[0m`)

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
