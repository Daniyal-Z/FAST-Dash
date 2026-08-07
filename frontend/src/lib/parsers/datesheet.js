/**
 * Parses the FSC exam datesheet workbook.
 *
 * This replaces the old FastAPI service (backend/services/datesheet.py), which
 * did the same job with pandas on every request.
 *
 * The sheet is a wide grid: `Day | Date | (Code, Course Name) × N`, where each
 * course-name column's *header* is the exam time slot ("09:00 - 10:00"). Day
 * and Date are vertically merged in Excel, so they only appear on the first row
 * of each day's block and must be forward-filled downwards.
 *
 * The exam sheet carries no room, section or seat information — five fields per
 * exam is the complete data model.
 */

import * as XLSX from 'xlsx'
import { cell, clean, createWarnings, isBlankRow } from './shared.js'

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
}

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]

/** A column header is a time slot if it looks like "09:00 - 10:00". */
function isSlotHeader(value) {
  const s = clean(value)
  return Boolean(s && /\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/.test(s))
}

function normaliseSlot(value) {
  const s = clean(value)
  if (!s) return null
  const m = /(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/.exec(s)
  return m ? `${m[1]} - ${m[2]}` : s
}

/** "25" -> 2025, "99" -> 1999. Four-digit years pass through unchanged. */
function expandYear(raw) {
  const n = Number(raw)
  if (raw.length === 4) return n
  return n < 70 ? 2000 + n : 1900 + n
}

/**
 * Turn a date cell into { display, iso, weekday }. Accepts "20-Sep-2025",
 * "27-Feb-25", "1-Mar-25", "20/09/2025", an Excel serial, or a Date. The
 * source sheets mix two- and four-digit years within a single column, so the
 * output is always re-formatted rather than echoed back.
 *
 * Day-first is assumed for ambiguous slash-separated dates.
 */
function parseDate(value) {
  if (value === null || value === undefined || value === '') return null

  let d = null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    d = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()))
  } else if (typeof value === 'number' && value > 20000 && value < 80000) {
    // Excel serial: days since 1899-12-30 (UTC to avoid TZ drift).
    d = new Date(Date.UTC(1899, 11, 30) + value * 86400000)
  } else {
    const s = clean(value)
    if (!s) return null
    // 20-Sep-2025 / 27-Feb-25 / 1 March 2025
    let m = /^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{2}|\d{4})$/.exec(s)
    if (m) {
      const key = m[2].toLowerCase()
      const month = MONTHS[key.slice(0, 4)] ?? MONTHS[key.slice(0, 3)]
      if (month !== undefined) d = new Date(Date.UTC(expandYear(m[3]), month, Number(m[1])))
    }
    if (!d) {
      m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/.exec(s)
      if (m) d = new Date(Date.UTC(expandYear(m[3]), Number(m[2]) - 1, Number(m[1])))
    }
    if (!d) {
      m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
      if (m) d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    }
    if (!d) return { display: s, iso: null, weekday: null, unparsed: true }
  }

  if (!d || Number.isNaN(d.getTime())) return null
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
  return {
    display: `${String(d.getUTCDate()).padStart(2, '0')}-${month}-${d.getUTCFullYear()}`,
    iso: d.toISOString().slice(0, 10),
    weekday: DAY_NAMES[d.getUTCDay()],
  }
}

/** Strip document-version noise: "StuV1.2", "V1.2", "STU-1.4". */
function stripVersion(s) {
  return s
    .replace(/\bstu\s*-?\s*v?\s*\d+(\.\d+)*/gi, ' ')
    .replace(/\bv\s*\d+(\.\d+)+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Best-effort label such as "Fall 2025 · Midterm I".
 *
 * The banners are unreliable — across the sample sheets one final exam is
 * headed only "COMPLETE DATE SHEET" and another is headed "MIDTERM - I" — and
 * the filenames disagree with them. So this is a starting suggestion only:
 * the admin confirms or edits it before publishing.
 *
 * When the banner names no exam, fall back to slot length: finals run in
 * three-hour blocks, midterms in one-hour blocks.
 */
function buildLabel(rows, slots) {
  const banner = stripVersion(cell(rows[0], 0) || '')
  const semester = stripVersion(cell(rows[1], 0) || '')

  const term = semester.replace(/\bsemester\b/i, '').replace(/\s+/g, ' ').trim()

  let exam = null
  if (/final/i.test(banner)) exam = 'Final'
  else if (/\bmid(term)?\b[^a-z]*\b(ii|2)\b/i.test(banner) || /\bII\b/.test(banner)) exam = 'Midterm II'
  else if (/\bmid(term)?\b/i.test(banner)) exam = 'Midterm I'

  if (!exam && slots.length) {
    const m = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(slots[0])
    if (m) {
      let mins = (Number(m[3]) * 60 + Number(m[4])) - (Number(m[1]) * 60 + Number(m[2]))
      if (mins < 0) mins += 12 * 60 // "1:00 - 4:00" is afternoon
      exam = mins >= 150 ? 'Final' : 'Midterm'
    }
  }

  if (term && exam) return `${term} · ${exam}`
  return term || banner || 'Datesheet'
}

/**
 * @param {import('xlsx').WorkBook} workbook
 * @returns {{ data: object, stats: object, warnings: string[], label: string }}
 */
export function parseDatesheet(workbook) {
  const warnings = createWarnings()

  const sheetName = workbook.SheetNames.includes('Complete')
    ? 'Complete'
    : workbook.SheetNames[0]
  if (sheetName !== 'Complete') {
    warnings.add(`Sheet "Complete" not found — using "${sheetName}" instead`)
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: false,
    defval: null,
    blankrows: true,
  })
  if (!rows.length) throw new Error(`Sheet "${sheetName}" is empty.`)

  // Locate the header row rather than trusting a fixed offset: find the row
  // whose first two cells are Day/Date and which carries slot headers.
  let headerIndex = -1
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const a = (cell(rows[r], 0) || '').toLowerCase()
    const b = (cell(rows[r], 1) || '').toLowerCase()
    if (a === 'day' && b === 'date' && (rows[r] || []).some(isSlotHeader)) {
      headerIndex = r
      break
    }
  }
  if (headerIndex === -1) {
    throw new Error(
      'Could not find the header row. Expected a row starting with "Day" and "Date" followed by time-slot columns such as "09:00 - 10:00".',
    )
  }

  const header = rows[headerIndex]

  // Map each course-name column to its slot. The layout is (Code, Name) pairs,
  // and the slot lives on the Name column's header.
  const columns = []
  for (let c = 2; c < header.length; c++) {
    if (!isSlotHeader(header[c])) continue
    columns.push({ codeCol: c - 1, nameCol: c, slot: normaliseSlot(header[c]) })
  }
  if (!columns.length) {
    throw new Error('No time-slot columns found in the header row.')
  }

  const slots = columns.map((c) => c.slot)
  const exams = []
  const dateOrder = []
  const seenDates = new Set()

  let lastDay = null
  let lastDate = null

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r]
    if (isBlankRow(row)) continue

    // Forward-fill the vertically merged Day/Date columns.
    const dayCell = cell(row, 0)
    const dateCell = row?.[1]
    if (dayCell) lastDay = dayCell
    const parsedDate = parseDate(dateCell)
    if (parsedDate) lastDate = parsedDate

    if (parsedDate?.unparsed) {
      warnings.add(`Could not read the date "${parsedDate.display}" — left as written`, `row ${r + 1}`)
    }

    if (!lastDate) {
      warnings.add('Row skipped: no date established yet', `row ${r + 1}`)
      continue
    }

    const day = lastDay || lastDate.weekday || null
    // Key on the ISO date when we have one, otherwise on the raw text, so a
    // date we could not parse still forms its own group rather than vanishing.
    const dateKey = lastDate.iso || `raw:${lastDate.display}`
    if (!seenDates.has(dateKey)) {
      seenDates.add(dateKey)
      dateOrder.push({ date: lastDate.display, iso: lastDate.iso, day })
    }

    for (const { codeCol, nameCol, slot } of columns) {
      const code = cell(row, codeCol)
      const name = cell(row, nameCol)
      if (!code && !name) continue
      if (!code) {
        warnings.add('Course name without a code — skipped', `row ${r + 1} "${name}"`)
        continue
      }
      exams.push({
        day,
        date: lastDate.display,
        iso: lastDate.iso,
        slot,
        code: code.toUpperCase(),
        name: name || code,
      })
    }
  }

  if (!exams.length) throw new Error('No exams found below the header row.')

  // Sort chronologically only when every date parsed; otherwise the sheet's
  // own top-to-bottom order is the more trustworthy signal.
  if (dateOrder.every((d) => d.iso)) {
    dateOrder.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0))
  }

  // Distinct courses, for the search/autocomplete list.
  const courseMap = new Map()
  for (const e of exams) if (!courseMap.has(e.code)) courseMap.set(e.code, e.name)
  const courses = [...courseMap]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.code.localeCompare(b.code))

  return {
    label: buildLabel(rows, slots),
    data: { slots, dates: dateOrder, exams, courses },
    warnings: warnings.list,
    stats: {
      exams: exams.length,
      courses: courses.length,
      days: dateOrder.length,
      slots: slots.length,
    },
  }
}
