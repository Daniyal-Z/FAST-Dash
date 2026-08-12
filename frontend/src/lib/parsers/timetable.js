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
  pad2,
} from './shared.js'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * A class lasting longer than this is treated as a data-entry error rather than
 * a real booking, and is reported instead of blocking out most of the week.
 * The longest legitimate class observed is a 240-minute lab.
 */
const MAX_SENSIBLE_DURATION = 300

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
  instructor: 3, // D — full name, e.g. "Ms. Maham Naeem"
  shortTitle: 8, // I
  shortInstructor: 9, // J — abbreviated, e.g. "Maham N"
  duration: 11, // L — "Duration in Minutes", stored as a string
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

function fromMinutes(mins) {
  const m = ((mins % 1440) + 1440) % 1440
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
}

/**
 * Identifies the per-programme course-list sheets by their header row rather
 * than by name.
 *
 * Every school names these differently — Computing uses CS, SE, DS, AI, CY, CI
 * — so hardcoding them would mean this parser only ever worked for one school.
 * What they share is the header row: a Code column, a Course Title column and a
 * Section column. The room-by-time grids ("Combined TT", "CS TT") and the
 * colour lookup tables have no such row and are skipped automatically.
 *
 * Returns sheets in workbook order, which is what fixes the offering ids.
 */
function findProgramSheets(workbook, readRows) {
  const found = []

  for (const name of workbook.SheetNames) {
    const rows = readRows(name)
    if (!rows || rows.length < 3) continue

    for (let r = 0; r < Math.min(rows.length, 6); r++) {
      const cells = (rows[r] || []).map((v) => (clean(v) || '').toLowerCase())
      const has = (needle) => cells.some((c) => c === needle || c.startsWith(needle))
      if (has('code') && has('course title') && has('section')) {
        found.push({ name, headerRow: r })
        break
      }
    }
  }

  return found
}

/**
 * The academic session containing a given date.
 *
 * Fall runs August to December and Spring January to June. July is the gap
 * between them, and it is when the next Fall's timetable gets prepared, so it
 * counts as Fall.
 *
 * `intakeYear` is the year the current first-years enrolled, and it is what the
 * year maths needs: a Spring 2027 student started in Fall 2026, so Spring's
 * intake year is the calendar year minus one. `displayYear` is what a human
 * calls the session.
 */
export function sessionFor(date) {
  const year = date.getFullYear()
  const isFall = date.getMonth() >= 6 // July onwards
  return {
    term: isFall ? 'Fall' : 'Spring',
    displayYear: year,
    intakeYear: isFall ? year : year - 1,
  }
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
 * @param {{ now?: Date }} [options] injected clock, so tests are deterministic
 * @returns {{ data: object, stats: object, warnings: string[], label: string }}
 */
export function parseTimetable(workbook, { now = new Date() } = {}) {
  const warnings = createWarnings()
  // Sheets are read more than once — to find the programme sheets, to survey
  // the batch years, and then to parse — so keep the parsed rows.
  const rowCache = new Map()
  const sheetRows = (name) => {
    if (rowCache.has(name)) return rowCache.get(name)
    const ws = workbook.Sheets[name]
    if (!ws) {
      rowCache.set(name, null)
      return null
    }
    // raw:false keeps Excel's own formatting for times; defval preserves the
    // column positions of empty cells so our fixed indexes stay aligned.
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: true,
    })
    rowCache.set(name, rows)
    return rows
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

  /**
   * Which period bands a class actually occupies.
   *
   * Most classes are 80 minutes and sit inside one 90-minute band, but labs run
   * 170 or even 240 minutes and genuinely spill into the following bands. The
   * sheet only records where a class *starts*, so without this a three-hour lab
   * looks like a 90-minute one and the grid wrongly shows the student as free
   * for the rest of it.
   */
  const coveredBands = (startMins, duration) => {
    const endMins = startMins + (duration || 0)
    const covered = bands.filter((b) => b.from < endMins && b.to > startMins)
    return covered.length ? covered : bands.filter((b) => startMins >= b.from && startMins < b.to)
  }

  const colorRows = sheetRows('ColorData')
  if (!colorRows) warnings.add('Sheet "ColorData" not found — all courses will use the fallback colour')
  const colors = readColorMap(colorRows, warnings)

  // The banner, e.g. "…TIME TABLE Fall 2026 (V1.0.2)". Only the version tag is
  // taken from it now; its year is not trusted for anything.
  let banner = null
  if (combined) {
    for (const row of combined.slice(0, 3)) {
      for (const raw of row || []) {
        const s = clean(raw)
        if (s && /time\s*table/i.test(s)) {
          banner = s.replace(/^.*?TIME\s*TABLE\s*/i, '').trim() || s
          break
        }
      }
      if (banner) break
    }
  }

  const programSheets = findProgramSheets(workbook, sheetRows)
  if (!programSheets.length) {
    throw new Error(
      'No course-list sheets found. Each programme sheet needs a header row ' +
        'containing "Code", "Course Title" and "Section".',
    )
  }

  /*
   * Which academic year each batch is in depends on when *now* is, not on
   * anything written in the workbook. A student who enrolled in 2024 is a
   * second year during 2025-26 and a third year during 2026-27, and no cell in
   * the sheet has to be edited for that to become true.
   *
   * Reading it from the sheet made a single mistyped cell able to move the
   * whole timetable: version 1.0.4 of the Fall 2026 workbook was headed "Fall
   * 2025", which put its 2026 intake in year 0 and slid every batch below it
   * down one. The calendar cannot be mistyped.
   *
   * The batch headings are still read, as a cross-check — the newest batch in
   * a current workbook should be the current intake, and when it is not, that
   * is worth telling the administrator about before they publish.
   */
  const session = sessionFor(now)
  const sessionYear = session.intakeYear

  const batchYears = []
  for (const { name, headerRow } of programSheets) {
    const rows = sheetRows(name)
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r]
      if (isBlankRow(row)) continue
      const headerLabel = detectHeaderLabel(row, cell(row, COL.code), cell(row, COL.title))
      if (headerLabel === null) continue
      const y = batchYearFromHeader(headerLabel)
      if (y) batchYears.push(y)
    }
  }

  const newestBatch = batchYears.length ? Math.max(...batchYears) : null
  if (newestBatch && newestBatch !== sessionYear) {
    warnings.add(
      `It is ${session.term} ${session.displayYear}, so the current intake should be ` +
        `${sessionYear}, but the newest batch in this workbook is ${newestBatch}. ` +
        `Years are numbered from ${sessionYear} — if this is last year's timetable, or ` +
        `next year's, the years shown will be off by ${Math.abs(newestBatch - sessionYear)}.`,
    )
  }

  const offerings = []
  const byKey = new Map()
  let nextId = 1

  for (const { name: sheetName, headerRow } of programSheets) {
    const rows = sheetRows(sheetName)

    let bucket = 'main'
    let batchYear = null
    let headerProg = null

    for (let r = headerRow + 1; r < rows.length; r++) {
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

      // An undergraduate section states its own year. BCS-3A is a second year
      // and BCS-4A is the same cohort a semester later, whatever the banner,
      // the batch headings or the calendar happen to say — so read it straight
      // off the section and the year cannot drift.
      //
      // Graduate sections do not work like that: MCS-1A shows up under the 2026
      // intake and again under the 2024 one, so the section name says nothing
      // about the year. For those, and for rows carrying no section at all, the
      // batch heading and the current session decide.
      let year = parsed && prog.startsWith('B') ? semToYear(parsed.sem) : null
      if (year === null && batchYear) year = sessionYear - batchYear + 1
      if (year === null && parsed) year = semToYear(parsed.sem)
      if (year === null) {
        warnings.add('Row skipped: cannot determine year', `${sheetName}!A${r + 1} ${code}`)
        continue
      }
      year = Math.min(Math.max(year, 1), 5)

      // "Duration in Minutes" arrives as a string, and is per class meeting.
      let duration = Number(String(cell(row, COL.duration) ?? '').replace(/[^\d]/g, '')) || null
      if (duration && duration > MAX_SENSIBLE_DURATION) {
        warnings.add(
          `Implausible duration of ${duration} minutes — treated as a single slot`,
          `${code} ${section}`,
        )
        duration = null
      }

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

        const startMins = toMinutes(time)
        const covered = coveredBands(startMins, duration)

        meetings.push({
          day,
          period,
          time: periods[period - 1].t,
          room: cell(row, venueCol) || 'TBA',
          // The class's own times, which can start part-way through a band and
          // finish part-way through a later one.
          start: time,
          end: duration ? fromMinutes(startMins + duration) : null,
          duration,
          // How many consecutive bands to draw across, starting at `period`.
          span: Math.max(1, covered.length),
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
        // Two names are kept because they serve different places: the blocks
        // are narrow and want the abbreviation, while the tooltip has room for
        // who the teacher actually is. Neither column is complete, so each
        // falls back to the other.
        instructor: cell(row, COL.shortInstructor) || cell(row, COL.instructor) || 'TBA',
        instructorFull: cell(row, COL.instructor) || cell(row, COL.shortInstructor) || 'TBA',
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

  // Built from the session rather than the banner, since the banner is the very
  // field that proved unreliable; the version tag is kept because it is useful
  // and is the one part of the banner nobody gets wrong.
  const version = banner && /\(?\bv\s*\d+(\.\d+)*\)?/i.exec(banner)
  const sessionLabel =
    `${session.term} ${session.displayYear}` + (version ? ` ${version[0].trim()}` : '')

  return {
    label: sessionLabel,
    data: { days: DAYS, periods, offerings },
    warnings: warnings.list,
    stats: {
      offerings: offerings.length,
      meetings: offerings.reduce((n, o) => n + o.meetings.length, 0),
      unslotted: offerings.filter((o) => o.unslotted).length,
      // Classes that run past their starting slot, and so are drawn across
      // more than one column. Worth surfacing: it is the difference between a
      // three-hour lab looking like a 90-minute one and looking correct.
      multiSlot: offerings.reduce((n, o) => n + o.meetings.filter((m) => m.span > 1).length, 0),
      buckets: tally('bucket'),
      programs: tally('prog'),
      years: tally('year'),
    },
  }
}
