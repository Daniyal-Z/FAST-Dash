import { useCallback, useEffect, useMemo, useState } from 'react'
import { sortSchools } from '../lib/schools.js'

/**
 * Remembers which school the visitor belongs to.
 *
 * Only schools that have actually published are offered. Two cases are handled
 * so the visitor never lands somewhere useless:
 *
 *  - a remembered school that has since been unpublished is forgotten, rather
 *    than leaving the page stuck on an empty state;
 *  - when exactly one school has published there is nothing to choose, so the
 *    step is skipped entirely.
 */
export function useSchoolChoice(storageKey, meta, kind) {
  const [school, setSchoolState] = useState(() => {
    try {
      return localStorage.getItem(storageKey)
    } catch {
      return null
    }
  })

  const setSchool = useCallback(
    (code) => {
      setSchoolState(code)
      try {
        if (code) localStorage.setItem(storageKey, code)
        else localStorage.removeItem(storageKey)
      } catch {
        /* storage unavailable — the choice just won't persist */
      }
    },
    [storageKey],
  )

  const published = useMemo(
    () => sortSchools((meta.rows ?? []).filter((r) => r.kind === kind).map((r) => r.school)),
    [meta.rows, kind],
  )

  useEffect(() => {
    if (meta.status !== 'ready') return
    if (school && !published.includes(school)) {
      setSchool(null)
      return
    }
    if (!school && published.length === 1) setSchool(published[0])
  }, [meta.status, published, school, setSchool])

  return { school, setSchool, published }
}
