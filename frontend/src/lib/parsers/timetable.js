/**
 * Parses the FSC class-timetable workbook into the shape the Timetable
 * builder consumes: { days, periods, offerings }.
 *
 * Source of truth is the per-program course-list sheets (CS, SE, DS, AI, CY,
 * CI) — NOT the "Combined TT" room grid. The grid is a rendered view that has
 * already lost course codes, full titles and the block grouping that tells us
 * whether a course is core, a repeat, or an elective.
 *
 * Each program sheet is a flat list of course rows interrupted by "block
 * header" rows (column A empty, column B holding a label such as
 * "BS(CS)-2026", "Labs", "Repeat Courses" or "SE Elective-IV"). Those headers
 * carry two pieces of state that the rows beneath them inherit: which bucket
 * the courses fall into, and which batch they belong to (which in turn decides
 * their colour).
 */

import * as XLSX from 'xlsx'
import {
  cell,
  clean,
  createWarnings,
  isBlankRow,
  normaliseTime,
} from './shared.js'

/** Program sheets, in the order that produces the canonical offering ids. */
const PROGRAM_SHEETS = ['CS', 'SE', 'DS', 'AI', 'CY', 'CI']

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Used when the workbook has no readable "Periods" row. */
const DEFAULT_PERIODS = [
  '08:30-10:00',
  '10:00-11:30',
  '11:30-13:00',
  '13:00-14:30',
  '14:30-16:00',
  '16:00-17:30',
  '17:30-19:00',
  '19:00-20:30',
]

/** Colour used for batches missing from the ColorData sheet. */
const FALLBACK_COLOR = { bg: '#e5e7eb', text: '#111827' }

// Column indexes in the program sheets (header row is row 2).
const COL = {
  code: 0, // A
  title: 1, // B
  section: 2, // C
  shortTitle: 8, // I
  shortInstructor: 9, // J
  day1: 12, // M
  slot1: 13, // N
  venue1: 14, // O
  day2: 15, // P
  slot2: 16, // Q
  venue2: 17, // R
}

const DAY_ALIASES = {
  mon: 'Mon', monday: 'Mon',
  tue: 'Tue', tues: 'Tue', tuesday: 'Tue',
  wed: 'Wed', weds: 'Wed', wednesday: 'Wed',
  thu: 'Thu', thur: 'Thu', thurs: 'Thu', thursday: 'Thu',
  fri: 'Fri', friday: 'Fri',
  sat: 'Sat', saturday: 'Sat',
  sun: 'Sun', sunday: 'Sun',
}

function normaliseDay(value) {
  const s = clean(value)
  if (!s) return null
  return DAY_ALIASES[s.toLowerCase().replace(/[^a-z]/g, '')] || null
}

/**
 * "BS(CS)" -> "BCS", "MS(SPM)" -> "MSP", "MS(CI)" -> "MCI".
 * The programme codes used throughout the app are always three characters.
 */
function progFromHeader(label) {
  const m = /\b(BS|MS)\s*\(\s*([A-Z]+)\s*\)/i.exec(label)
  if (!m) return null
  const prefix = m[1].toUpperCase() === 'BS' ? 'B' : 'M'
  return (prefix + m[2].toUpperCase()).slice(0, 3)
}

/** First four-digit year in a block header ("BS(AI)-2025 (58)" -> 2025). */
function batchYearFromHeader(label) {
  const m = /\b(19|20)\d{2}\b/.exec(label)
  return m ? Number(m[0]) : null
}

/**
 * Bucket is decided purely by the block header text. The `Category` column is
 * unusable for this: "SE (Elective)" also appears under non-elective headers.
 *
 * Returns null for labels that carry no bucket meaning — annotations such as
 * "Merged with DS" or " Spring 2025 (7) & Fall 2024 (5)". Those are notes
 * sitting inside a block, so the surrounding bucket must survive them.
 */
function bucketFromHeader(label) {
  if (progFromHeader(label)) return 'main' // a batch heading starts a core block
  if (/repeat/i.test(label)) return 'repeat'
  if (/elective/i.test(label)) return 'elective'
  if (/^labs?\b/i.test(label)) return 'main'
  return null
}

/** "BCS-1A" / "BSE-1A1" -> { prog: "BCS", sem: 1 }. */
function parseSection(primSection) {
  if (!primSection) return null
  const m = /^([A-Za-z]{3})-(\d)/.exec(primSection)
  if (!m) return null
  return { prog: m[1].toUpperCase(), sem: Number(m[2]) }
}

/**
 * Reduce a raw section string to the section a student actually picks.
 *
 * "BCS-1A/3A"   -> "BCS-1A"   (the "/3A" is the repeat cohort sharing the slot)
 * "BCS-1A1/3A1" -> "BCS-1A"   (lab sub-groups collapse to their parent section)
 */
function toPrimSection(sectionRaw) {
  if (!sectionRaw) return null
  const first = sectionRaw.split('/')[0].trim()
  const m = /^([A-Za-z]{3}-\d[A-Za-z])/.exec(first)
  return m ? m[1].toUpperCase() : first
}

/**
 * Returns the block-header label for a row, or null when the row is a course.
 *
 * A header carries a single label and nothing else — no section, no schedule.
 * That "nothing else" test is what distinguishes it from a genuine course that
 * merely lacks a timetable slot (e.g. "SE4091 Final Year Project-I, BSE-7A").
 */
function detectHeaderLabel(row, code, titleCell) {
  const hasCourseDetail =
    cell(row, COL.section) ||
    cell(row, COL.shortTitle) ||
    cell(row, COL.shortInstructor) ||
    cell(row, COL.day1) ||
    cell(row, COL.slot1)

  if (hasCourseDetail) return null
  // Label in column A with no title beside it.
  if (code && !titleCell) return code
  // Label in column B with no code beside it.
  if (!code && titleCell) return titleCell
  return null
}

/** A well-formed course code, e.g. CS1002, MT4031, CL1000. */
const WELL_FORMED_CODE = /^[A-Z]{2,3}\d{3,4}$/i

/**
 * Some rows are annotations rather than courses: "CYXXXX / Cyber Elective-IV
 * reqiured", "SS5014/SS5016 / …(merged with SPM)". They are recognisable by
 * having neither a section nor a real course code — a genuine section-less
 * course (Professional Practices, MS Thesis) still carries a valid code.
 */
function isAnnotationRow(code, sectionRaw) {
  return !sectionRaw && !WELL_FORMED_CODE.test(code)
}

/** Minutes since midnight, for slot-to-band matching. */
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Semester number -> academic year. Semesters 1&2 are year 1, and so on. */
function semToYear(sem) {
  return Math.ceil(sem / 2)
}

/** Read the eight period bands out of the "Combined TT" sheet, if present. */
function readPeriods(rows) {
  const found = []
  for (const row of rows.slice(0, 8)) {
    if (!row) continue
    for (const raw of row) {
      const s = clean(raw)
      if (s && /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(s)) {
        const normalised = s.replace(/\s*-\s*/, '-')
        if (!found.includes(normalised)) found.push(normalised)
      }
    }
    if (found.length >= 4) break
  }
  return found.length ? found : null
}

/** Read the batch -> colour map out of the "ColorData" sheet. */
function readColorMap(rows, warnings) {
  const map = new Map()
  if (!rows) return map
  for (const row of rows.slice(1)) {
    const key = cell(row, 1)
    const bg = cell(row, 2)
    const text = cell(row, 3)
    if (!key) continue
    if (!bg || !text) {
      warnings.add('ColorData row missing a colour', key)
      continue
    }
    map.set(key.toUpperCase(), { bg: bg.toLowerCase(), text: text.toLowerCase() })
  }
  return map
}

/**
 * @param {import('xlsx').WorkBook} workbook
 * @returns {{ data: object, stats: object, warnings: string[], label: string }}
 */
export function parseTimetable(workbook) {
  const warnings = createWarnings()
  const sheetRows = (name) => {
    const ws = workbook.Sheets[name]
    if (!ws) return null
    // raw:false keeps Excel's own formatting for times; defval preserves the
    // column positions of empty cells so our fixed indexes stay aligned.
    return XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: true,
    })
  }

  const combined = sheetRows('Combined TT')
  const periodTimes = (combined && readPeriods(combined)) || DEFAULT_PERIODS
  if (!combined) warnings.add('Sheet "Combined TT" not found — using default period times')

  const periods = periodTimes.map((t, i) => ({ p: i + 1, t }))

  // Scheduled times do not always sit exactly on a band boundary — a handful of
  // rows use 10:30, 09:00, 14:00, 15:00. Each belongs to the band that contains
  // it, so match by range rather than by an exact start-time equality.
  const bands = periods.map((p) => {
    const [from, to] = p.t.split('-')
    return { p: p.p, from: toMinutes(from), to: toMinutes(to) }
  })
  const periodForTime = (hhmm) => {
    const mins = toMinutes(hhmm)
    const band = bands.find((b) => mins >= b.from && mins < b.to)
    return band ? band.p : null
  }

  const colorRows = sheetRows('ColorData')
  if (!colorRows) warnings.add('Sheet "ColorData" not found — all courses will use the fallback colour')
  const colors = readColorMap(colorRows, warnings)

  // Session year, e.g. "…TIME TABLE Fall 2026 (V1.0.2)" -> 2026. Used to turn
  // a batch's intake year into an academic year for section-less rows.
  let label = null
  let sessionYear = null
  if (combined) {
    for (const row of combined.slice(0, 3)) {
      for (const raw of row || []) {
        const s = clean(raw)
        if (s && /time\s*table/i.test(s)) {
          label = s.replace(/^.*?TIME\s*TABLE\s*/i, '').trim() || s
          const m = /\b(19|20)\d{2}\b/.exec(s)
          if (m) sessionYear = Number(m[0])
          break
        }
      }
      if (label) break
    }
  }
  if (!sessionYear) {
    sessionYear = new Date().getFullYear()
    warnings.add(`Could not read the session year from the workbook — assuming ${sessionYear}`)
  }

  const offerings = []
  const byKey = new Map()
  let nextId = 1

  for (const sheetName of PROGRAM_SHEETS) {
    const rows = sheetRows(sheetName)
    if (!rows) {
      warnings.add(`Program sheet "${sheetName}" not found`)
      continue
    }

    let bucket = 'main'
    let batchYear = null
    let headerProg = null

    // Row 1 is the banner and row 2 the column header, so data starts at index 2.
    for (let r = 2; r < rows.length; r++) {
      const row = rows[r]
      if (isBlankRow(row)) continue

      const code = cell(row, COL.code)
      const titleCell = cell(row, COL.title)

      // Block headers are lone labels on an otherwise empty row. The workbook
      // is inconsistent about which column holds them: batch headings sit in
      // column B, while sub-headings ("Labs", "Repeat Courses") sit in column A.
      const headerLabel = detectHeaderLabel(row, code, titleCell)
      if (headerLabel !== null) {
        const b = bucketFromHeader(headerLabel)
        if (b) bucket = b
        const p = progFromHeader(headerLabel)
        if (p) headerProg = p
        const y = batchYearFromHeader(headerLabel)
        if (y) batchYear = y
        continue
      }
      if (!code) continue

      const sectionRaw = cell(row, COL.section)
      if (isAnnotationRow(code, sectionRaw)) {
        warnings.add('Skipped a note row (no section and no valid course code)', `${sheetName} "${code}"`)
        continue
      }
      const section = sectionRaw || '—'
      const primSection = toPrimSection(sectionRaw)
      const parsed = parseSection(primSection)

      const prog = parsed?.prog || headerProg
      if (!prog) {
        warnings.add(`Row skipped: cannot determine programme`, `${sheetName}!A${r + 1} ${code}`)
        continue
      }

      // The batch heading is the authority on which year a course belongs to.
      // For undergraduate sections the semester digit agrees with it exactly;
      // for graduate sections it does not (MCS-1A can be a third-year batch),
      // so the section is only a fallback for rows outside any batch block.
      let year = batchYear ? sessionYear - batchYear + 1 : null
      if (year === null && parsed) year = semToYear(parsed.sem)
      if (year === null) {
        warnings.add('Row skipped: cannot determine year', `${sheetName}!A${r + 1} ${code}`)
        continue
      }
      year = Math.min(Math.max(year, 1), 5)

      const meetings = []
      for (const [dayCol, slotCol, venueCol] of [
        [COL.day1, COL.slot1, COL.venue1],
        [COL.day2, COL.slot2, COL.venue2],
      ]) {
        const day = normaliseDay(row?.[dayCol])
        const time = normaliseTime(row?.[slotCol])
        if (!day || !time) {
          // A half-filled meeting is worth flagging; a fully empty one is normal.
          if (day || time) {
            warnings.add('Incomplete meeting (missing day or time)', `${sheetName} ${code} ${section}`)
          }
          continue
        }
        const period = periodForTime(time)
        if (!period) {
          warnings.add(`Slot "${time}" matches no period band — course left unslotted`, `${code} ${section}`)
          continue
        }
        meetings.push({
          day,
          period,
          time: periods[period - 1].t,
          room: cell(row, venueCol) || 'TBA',
        })
      }

      const colorKey = `${prog}-${batchYear ?? sessionYear - year + 1}`
      const color = colors.get(colorKey)
      if (!color && colors.size) {
        warnings.add('No colour defined for batch — using grey', colorKey)
      }

      const courseName = cell(row, COL.shortTitle) || titleCell || code

      // The same class can be split across consecutive rows, one per weekly
      // meeting (CL3001 for BDS-7B is listed twice, same course, two slots).
      // The course name has to be part of the key: a code is not unique — the
      // lecture and its lab share one (DS3004 = "DWBI" and "DWBI Lab"), and
      // placeholder codes like CSXXXX cover four different MCI courses.
      const dedupeKey = [prog, year, bucket, code, section, courseName].join('|')
      const existing = byKey.get(dedupeKey)
      if (existing) {
        for (const m of meetings) {
          const dup = existing.meetings.some(
            (x) => x.day === m.day && x.period === m.period && x.room === m.room,
          )
          if (!dup) existing.meetings.push(m)
        }
        existing.unslotted = existing.meetings.length === 0
        continue
      }

      const offering = {
        id: `o${nextId++}`,
        code,
        course: courseName,
        title: titleCell || cell(row, COL.shortTitle) || code,
        section,
        primSection,
        prog,
        year,
        bucket,
        instructor: cell(row, COL.shortInstructor) || 'TBA',
        bg: color?.bg || FALLBACK_COLOR.bg,
        text: color?.text || FALLBACK_COLOR.text,
        unslotted: meetings.length === 0,
        meetings,
      }
      byKey.set(dedupeKey, offering)
      offerings.push(offering)
    }
  }

  if (!offerings.length) {
    throw new Error(
      'No course offerings found. Expected sheets named CS, SE, DS, AI, CY and CI with a header row on row 2.',
    )
  }

  const tally = (key) =>
    offerings.reduce((acc, o) => ((acc[o[key]] = (acc[o[key]] || 0) + 1), acc), {})

  return {
    label: label || `Timetable ${sessionYear}`,
    data: { days: DAYS, periods, offerings },
    warnings: warnings.list,
    stats: {
      offerings: offerings.length,
      meetings: offerings.reduce((n, o) => n + o.meetings.length, 0),
      unslotted: offerings.filter((o) => o.unslotted).length,
      buckets: tally('bucket'),
      programs: tally('prog'),
      years: tally('year'),
    },
  }
}
