/**
 * The schools and departments that publish their own class timetable.
 *
 * Each maintains a separate workbook, built to the same layout, so each gets
 * its own published dataset. The exam datesheet is the exception: it is issued
 * once for the whole university and covers every school's courses, so it is
 * filed under ALL rather than per school.
 */

export const SCHOOLS = [
  { code: 'FSC', name: 'FAST School of Computing', short: 'Computing' },
  { code: 'FSM', name: 'FAST School of Management', short: 'Management' },
  { code: 'DEE', name: 'Department of Electrical Engineering', short: 'Electrical Engineering' },
  { code: 'DCE', name: 'Department of Civil Engineering', short: 'Civil Engineering' },
  { code: 'DSH', name: 'Department of Science and Humanities', short: 'Science & Humanities' },
]

/** Sentinel school for datasets that are not school-specific. */
export const ALL_SCHOOLS = 'ALL'

const BY_CODE = new Map(SCHOOLS.map((s) => [s.code, s]))

export function schoolName(code) {
  if (code === ALL_SCHOOLS) return 'All schools'
  return BY_CODE.get(code)?.name ?? code
}

export function schoolShort(code) {
  if (code === ALL_SCHOOLS) return 'All schools'
  return BY_CODE.get(code)?.short ?? code
}

/** Order a set of school codes the way SCHOOLS lists them, unknowns last. */
export function sortSchools(codes) {
  const order = new Map(SCHOOLS.map((s, i) => [s.code, i]))
  return [...codes].sort(
    (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b),
  )
}
