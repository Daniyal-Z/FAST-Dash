import { useCallback, useEffect, useRef, useState } from 'react'
import { TooltipPortal } from '../components/Tooltip.jsx'

const SHOW_DELAY = 110
const HIDE_DELAY = 60

/**
 * Hover/focus tooltips for the schedule grids.
 *
 * Returns `bind(content)` to spread onto any element, and a `tooltip` node to
 * render once per view. One shared portal serves every trigger, so a grid of
 * forty blocks adds no extra DOM.
 *
 * The panel is positioned `fixed`, so it must be dismissed on scroll: pointer
 * events do not fire during a wheel scroll, and it would otherwise hang in
 * place while the grid moved beneath it.
 */
export function useTooltip() {
  const [tip, setTip] = useState(null) // { content, rect }
  const timer = useRef(null)

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  const show = useCallback((el, content) => {
    clear()
    timer.current = setTimeout(() => {
      setTip({ content, rect: el.getBoundingClientRect() })
    }, SHOW_DELAY)
  }, [])

  const hide = useCallback(() => {
    clear()
    timer.current = setTimeout(() => setTip(null), HIDE_DELAY)
  }, [])

  // A fixed-position tooltip would drift away from its trigger on scroll, and
  // pointer events do not fire while a wheel scroll is in progress.
  useEffect(() => {
    if (!tip) return
    const dismiss = () => {
      clear()
      setTip(null)
    }
    const onKey = (e) => e.key === 'Escape' && dismiss()
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [tip])

  useEffect(() => clear, [])

  const bind = useCallback(
    (content) => ({
      onMouseEnter: (e) => show(e.currentTarget, content),
      onMouseLeave: hide,
      onFocus: (e) => show(e.currentTarget, content),
      onBlur: hide,
    }),
    [show, hide],
  )

  return {
    bind,
    tooltip: tip ? <TooltipPortal rect={tip.rect}>{tip.content}</TooltipPortal> : null,
  }
}

