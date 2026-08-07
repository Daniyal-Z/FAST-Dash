/**
 * Helpers shared by the timetable and datesheet parsers.
 *
 * The source workbooks are maintained by hand and are consistently messy:
 * stray whitespace, HTML entities that survived a copy-paste, mojibake from a
 * bad encoding round-trip, and headings whose casing drifts between sheets.
 * Everything here exists to absorb that without losing real content.
 *
 * Non-ASCII is written as \u escapes on purpose — this file is all about
 * mangled encodings, and literal bytes here would be fragile.
 */

// Mojibake produced when UTF-8 punctuation was decoded as Latin-1/CP1252.
// Order matters: "â€" is a prefix of the rest, so it is tried last.
const MOJIBAKE = [
  [/\u00e2\u20ac\u201c/g, '\u2013'], // en dash
  [/\u00e2\u20ac\u201d/g, '\u2014'], // em dash
  [/\u00e2\u20ac\u2122/g, '\u2019'], // right single quote
  [/\u00e2\u20ac\u0153/g, '\u201c'], // left double quote
  [/\u00e2\u20ac\u00a6/g, '\u2026'], // ellipsis
  [/\u00e2\u20ac\u009d/g, '\u201d'], // right double quote
  [/\u00c2\u00a0/g, ' '], // mojibake non-breaking space
  [/\ufffd/g, '\u2013'], // replacement char: in these sheets it is always an en dash
]

const ENTITIES = [
  [/&amp;/gi, '&'],
  [/&nbsp;/gi, ' '],
  [/&quot;/gi, '"'],
  [/&#39;|&apos;/gi, "'"],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
]

/**
 * Normalise a cell into a trimmed string, or null when it holds nothing
 * meaningful. Collapses internal runs of whitespace, repairs mojibake and
 * decodes the HTML entities that leak in from the source sheets.
 */
export function clean(value) {
  if (value === null || value === undefined) return null
  let s = typeof value === 'string' ? value : String(value)
  for (const [re, to] of MOJIBAKE) s = s.replace(re, to)
  // Decode entities repeatedly so "&amp;amp;" fully unwinds.
  for (let i = 0; i < 3; i++) {
    const before = s
    for (const [re, to] of ENTITIES) s = s.replace(re, to)
    if (s === before) break
  }
  s = s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length ? s : null
}

/** Read a cell from an array-of-arrays row, cleaned. */
export function cell(row, index) {
  if (!row) return null
  return clean(row[index])
}

/** True when every cell in the row is empty. */
export function isBlankRow(row) {
  if (!row || !row.length) return true
  return row.every((v) => clean(v) === null)
}

/**
 * Pull "HH:MM" out of a cell that may be a string, an Excel time fraction, or
 * a Date. Returns null when nothing time-like is present.
 */
export function normaliseTime(value) {
  if (value === null || value === undefined || value === '') return null

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`
  }

  // Excel stores times as a fraction of a day.
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const mins = Math.round(value * 24 * 60)
    return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`
  }

  const s = clean(value)
  if (!s) return null
  const m = /(\d{1,2}):(\d{2})/.exec(s)
  if (!m) return null
  return `${pad2(Number(m[1]))}:${m[2]}`
}

export function pad2(n) {
  return String(n).padStart(2, '0')
}

/** Course codes are compared case- and whitespace-insensitively everywhere. */
export function normaliseCode(code) {
  const s = clean(code)
  return s ? s.toUpperCase().replace(/\s+/g, '') : null
}

/**
 * Collects parser warnings without letting a single bad row abort the run.
 * The admin UI renders these before anything is published.
 */
export function createWarnings() {
  const items = []
  return {
    add(message, context) {
      items.push(context ? `${message} (${context})` : message)
    },
    get list() {
      // De-duplicate: one malformed pattern usually repeats across many rows.
      const counts = new Map()
      for (const w of items) counts.set(w, (counts.get(w) || 0) + 1)
      return [...counts].map(([msg, n]) => (n > 1 ? `${msg} ×${n}` : msg))
    },
    get count() {
      return items.length
    },
  }
}
