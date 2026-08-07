import { useCallback, useState } from 'react'

/**
 * Open/closed state for the course panel, remembered between visits.
 *
 * Defaults to open: the panel is how you pick courses in the first place, so a
 * first-time visitor should never have to find it. Once a schedule is built it
 * mostly gets in the way of the grid, which is what collapsing is for.
 */
export function usePanel(key = 'fastdash:panel') {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== 'closed'
    } catch {
      return true
    }
  })

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      const next = !wasOpen
      try {
        localStorage.setItem(key, next ? 'open' : 'closed')
      } catch {
        /* storage unavailable — the choice just won't persist */
      }
      return next
    })
  }, [key])

  return { open, toggle }
}
