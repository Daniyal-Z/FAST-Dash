/**
 * Parses a class-timetable workbook into the shape the Timetable builder
 * consumes: { days, periods, offerings }.
 *
 * Every school keeps its own workbook and no two are laid out alike, so nothing
 * here is addressed by name or position:
 *
 *  - The course-list sheets are found by their header row (Code + Course Title
 *    + Section), not by sheet name — Computing calls them CS, SE, DS, AI, CY,
 *    CI; Management has a single "Course List".
 *  - Columns are located by their heading. Computing puts Code/Title/Section
 *    first and carries the schedule beside them; Management puts them at 5, 6
 *    and 7 behind Batch/Semester/Core-or-Elective.
 *  - Where a course list has no Day/Slot/Venue columns at all, as Management's
 *    does not, the schedule is recovered from the room-by-time grid and joined
 *    back on course title and section.
 *
 * The room-by-time grid is never used as the catalogue, only as the schedule:
 * it has already lost course codes, full titles and the core/elective split.
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

/*
 * Column layout is not fixed. Computing lists Code / Course Title / Section in
 * the first three columns and carries the schedule alongside; Management puts
 * them at 5, 6 and 7 behind Batch / Semester / Core-or-Elective, and has no
 * schedule columns at all. So columns are located by their heading.
 */
const COLUMN_ALIASES = {
  code: ['code'],
  title: ['course title'],
  section: ['section'],
  instructor: ['instructor name', 'teacher'],
  shortTitle: ['course short title'],
  shortInstructor: ['instructor short name'],
  duration: ['duration in minutes'],
  day1: ['day 1'], slot1: ['slot 1'], venue1: ['venue 1'],
  day2: ['day 2'], slot2: ['slot 2'], venue2: ['venue 2'],
  semester: ['semester'],
  // Only an explicit core/elective column. Computing's "Category" is unusable
  // for this — "SE (Elective)" appears under non-elective headings.
  category: ['core / elective', 'core/elective'],
}

const normaliseHeader = (v) => (clean(v) || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.:]+$/, '')

/** Map each known field to the column it occupies in this sheet's header row. */
function resolveColumns(headerCells) {
  const seen = headerCells.map(normaliseHeader)
  const cols = {}
  for (const [field, names] of Object.entries(COLUMN_ALIASES)) {
    const i = seen.findIndex((h) => names.includes(h))
    if (i !== -1) cols[field] = i
  }
  return cols
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

/** "BCS-1A" -> { prog: "BCS", sem: 1 }. Codes may carry digits, e.g. "MB2-3A". */
function parseSection(primSection) {
  if (!primSection) return null
  const m = /^([A-Za-z][A-Za-z0-9]{1,4})-(\d)/.exec(primSection)
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
  const m = /^([A-Za-z][A-Za-z0-9]{1,4}-\d[A-Za-z])/.exec(first)
  return m ? m[1].toUpperCase() : first
}

/**
 * Returns the block-header label for a row, or null when the row is a course.
 *
 * A header carries a single label and nothing else — no section, no schedule.
 * That "nothing else" test is what distinguishes it from a genuine course that
 * merely lacks a timetable slot (e.g. "SE4091 Final Year Project-I, BSE-7A").
 */
function detectHeaderLabel(row, cols) {
  const code = cell(row, cols.code)
  const title = cell(row, cols.title)

  const hasCourseDetail =
    cell(row, cols.section) ||
    cell(row, cols.shortTitle) ||
    cell(row, cols.shortInstructor) ||
    cell(row, cols.instructor) ||
    cell(row, cols.day1) ||
    cell(row, cols.slot1)

  if (hasCourseDetail) return null
  if (code && !title) return code
  if (!code && title) return title
  if (!code && !title) {
    // Management writes its programme headings in the first column, well to
    // the left of the course columns, so nothing above finds them.
    return (row || []).map(clean).find(Boolean) || null
  }
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

    for (let r = 0; r < Math.min(rows.length, 8); r++) {
      const cols = resolveColumns(rows[r] || [])
      if (cols.code !== undefined && cols.title !== undefined && cols.section !== undefined) {
        found.push({ name, headerRow: r, cols })
        break
      }
    }
  }

  return found
}


/* ------------------------------------------------------------- time bands */

/**
 * "08:30-10:00", "8:30 AM to 9:50 AM", "1:00 PM to 2:20 PM." and
 * "6:00 P.M.to 9:00 PM" all have to come out as the same thing.
 */
function parseTimeRange(text) {
  const s = String(text ?? '').toLowerCase().replace(/\./g, '')
  const re = /(\d{1,2}):(\d{2})\s*(am|pm)?/g
  const found = []
  let m
  while ((m = re.exec(s)) !== null && found.length < 2) {
    let h = Number(m[1])
    const mins = Number(m[2])
    if (m[3] === 'pm' && h !== 12) h += 12
    if (m[3] === 'am' && h === 12) h = 0
    found.push(h * 60 + mins)
  }
  if (found.length < 2) return null
  let [from, to] = found
  // "1:00 - 2:20" with no am/pm on a sheet that means the afternoon.
  if (to <= from) to += 12 * 60
  return to > from ? { from, to } : null
}

/**
 * Locates the room-by-time grid: the sheet with a Days column, a Room column
 * and a row of time bands. Both schools have one; only the details differ —
 * Computing puts the bands one row above the Days/Room header, Management puts
 * them on the same row.
 */
function findGridSheet(workbook, readRows) {
  for (const name of workbook.SheetNames) {
    const rows = readRows(name)
    if (!rows || rows.length < 5) continue

    let daysRow = -1
    let dayCol = -1
    let roomCol = -1
    for (let r = 0; r < Math.min(rows.length, 8); r++) {
      const cells = (rows[r] || []).map(normaliseHeader)
      const d = cells.findIndex((c) => c === 'days' || c === 'day')
      const room = cells.findIndex((c) => c === 'room' || c === 'rooms')
      if (d !== -1 && room !== -1) { daysRow = r; dayCol = d; roomCol = room; break }
    }
    if (daysRow === -1) continue

    // The bands sit on the Days row or just above it.
    let bands = []
    for (let r = daysRow; r >= 0 && r >= daysRow - 3; r--) {
      const found = []
      ;(rows[r] || []).forEach((v, col) => {
        const range = parseTimeRange(v)
        if (range) found.push({ col, ...range })
      })
      if (found.length >= 3) { bands = found; break }
    }
    if (bands.length < 3) continue

    return { name, rows, daysRow, dayCol, roomCol, bands }
  }
  return null
}

/**
 * Reads the schedule out of the grid, for workbooks whose course list carries
 * none. Each cell reads "Course (Section) Teacher" — Computing separates the
 * teacher with a colon, Management with a space — and its column decides the
 * band while its row decides the day and room.
 */
function readGridSchedule(grid) {
  const entries = []
  let day = null

  for (let r = grid.daysRow + 1; r < grid.rows.length; r++) {
    const row = grid.rows[r]
    if (!row) continue
    const maybeDay = normaliseDay(row[grid.dayCol])
    if (maybeDay) day = maybeDay // the day is written once per band of rows
    const room = cell(row, grid.roomCol)
    if (!day) continue

    row.forEach((raw, col) => {
      if (col === grid.dayCol || col === grid.roomCol) return
      const text = clean(raw)
      if (!text) return
      const m = /^(.+?)\s*\(([^)]+)\)\s*:?\s*(.*)$/.exec(text)
      if (!m) return

      // The band is the last one starting at or before this column.
      let band = null
      for (const b of grid.bands) if (b.col <= col && (!band || b.col > band.col)) band = b
      if (!band) return

      entries.push({
        day,
        room: room || 'TBA',
        title: m[1].trim(),
        section: m[2].trim(),
        teacher: m[3].trim() || null,
        band,
      })
    })
  }
  return entries
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

  const grid = findGridSheet(workbook, sheetRows)
  const periodTimes = grid
    ? grid.bands.map((b) => `${fromMinutes(b.from)}-${fromMinutes(b.to)}`)
    : DEFAULT_PERIODS
  if (!grid) warnings.add('No room-by-time grid found — using default period times')

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
  if (grid) {
    for (const row of grid.rows.slice(0, 3)) {
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
  for (const { name, headerRow, cols } of programSheets) {
    const rows = sheetRows(name)
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r]
      if (isBlankRow(row)) continue
      const headerLabel = detectHeaderLabel(row, cols)
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

  for (const { name: sheetName, headerRow, cols } of programSheets) {
    const rows = sheetRows(sheetName)

    let bucket = 'main'
    let batchYear = null
    let headerProg = null

    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r]
      if (isBlankRow(row)) continue

      const code = cell(row, cols.code)
      const titleCell = cell(row, cols.title)

      // Block headers are lone labels on an otherwise empty row. Which column
      // holds them varies: Computing's batch headings sit in column B and its
      // sub-headings ("Labs", "Repeat Courses") in column A, while Management
      // writes programme headings to the left of the course columns entirely.
      const headerLabel = detectHeaderLabel(row, cols)
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

      /*
       * Where the sheet states core-or-elective per row, that is better than
       * inferring it from a block heading. Management has such a column ("C" /
       * "E"); Computing does not, and its "Category" column cannot be used —
       * "SE (Elective)" appears under non-elective headings — so there the
       * block heading still decides.
       */
      const categoryCell = cols.category !== undefined ? cell(row, cols.category) : null
      const rowBucket = /^e/i.test(categoryCell || '')
        ? 'elective'
        : /^c/i.test(categoryCell || '')
          ? 'main'
          : bucket

      const sectionRaw = cell(row, cols.section)
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
      let duration = Number(String(cell(row, cols.duration) ?? '').replace(/[^\d]/g, '')) || null
      if (duration && duration > MAX_SENSIBLE_DURATION) {
        warnings.add(
          `Implausible duration of ${duration} minutes — treated as a single slot`,
          `${code} ${section}`,
        )
        duration = null
      }

      const meetings = []
      for (const [dayCol, slotCol, venueCol] of [
        [cols.day1, cols.slot1, cols.venue1],
        [cols.day2, cols.slot2, cols.venue2],
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

      const courseName = cell(row, cols.shortTitle) || titleCell || code

      // The same class can be split across consecutive rows, one per weekly
      // meeting (CL3001 for BDS-7B is listed twice, same course, two slots).
      // The course name has to be part of the key: a code is not unique — the
      // lecture and its lab share one (DS3004 = "DWBI" and "DWBI Lab"), and
      // placeholder codes like CSXXXX cover four different MCI courses.
      const dedupeKey = [prog, year, rowBucket, code, section, courseName].join('|')
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
        title: titleCell || cell(row, cols.shortTitle) || code,
        section,
        primSection,
        prog,
        year,
        bucket: rowBucket,
        // Two names are kept because they serve different places: the blocks
        // are narrow and want the abbreviation, while the tooltip has room for
        // who the teacher actually is. Neither column is complete, so each
        // falls back to the other.
        instructor: cell(row, cols.shortInstructor) || cell(row, cols.instructor) || 'TBA',
        instructorFull: cell(row, cols.instructor) || cell(row, cols.shortInstructor) || 'TBA',
        bg: color?.bg || FALLBACK_COLOR.bg,
        text: color?.text || FALLBACK_COLOR.text,
        unslotted: meetings.length === 0,
        meetings,
      }
      byKey.set(dedupeKey, offering)
      offerings.push(offering)
    }
  }

  /*
   * Workbooks whose course list has no Day/Slot/Venue columns keep their
   * schedule only in the grid. Management is one: its course list is the
   * authoritative catalogue — codes, titles, sections, teachers, core-or-
   * elective — and the grid is where those courses are actually placed.
   *
   * They are joined on course title and section, which is all the grid gives.
   * Section is matched through toPrimSection so a grid entry for a lab
   * sub-group ("BAF-1A1") finds its parent section ("BAF-1A").
   */
  const needsGridSchedule = offerings.length > 0 && offerings.every((o) => o.meetings.length === 0)
  if (needsGridSchedule && grid) {
    const key = (title, section) =>
      `${(title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${toPrimSection(section) || ''}`

    const byTitleSection = new Map()
    for (const o of offerings) {
      const k = key(o.title, o.section)
      if (!byTitleSection.has(k)) byTitleSection.set(k, [])
      byTitleSection.get(k).push(o)
      // Short titles are what the grid tends to use.
      const ks = key(o.course, o.section)
      if (ks !== k) {
        if (!byTitleSection.has(ks)) byTitleSection.set(ks, [])
        byTitleSection.get(ks).push(o)
      }
    }

    let placed = 0
    let unmatched = 0
    for (const entry of readGridSchedule(grid)) {
      const matches = byTitleSection.get(key(entry.title, entry.section))
      if (!matches || !matches.length) {
        unmatched++
        warnings.add('A grid entry matches no course in the list', `${entry.title} (${entry.section})`)
        continue
      }
      const meeting = {
        day: entry.day,
        period: grid.bands.indexOf(entry.band) + 1,
        time: `${fromMinutes(entry.band.from)}-${fromMinutes(entry.band.to)}`,
        room: entry.room,
        start: fromMinutes(entry.band.from),
        end: fromMinutes(entry.band.to),
        duration: entry.band.to - entry.band.from,
        span: 1,
      }
      for (const o of matches) {
        const already = o.meetings.some(
          (m) => m.day === meeting.day && m.period === meeting.period && m.room === meeting.room,
        )
        if (!already) o.meetings.push(meeting)
      }
      placed++
    }
    for (const o of offerings) o.unslotted = o.meetings.length === 0

    warnings.add(
      `Schedule taken from the grid: ${placed} entries placed` +
        (unmatched ? `, ${unmatched} could not be matched to a course` : ''),
    )
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
