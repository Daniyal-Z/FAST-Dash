import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const GAP = 10 // space between the trigger and the tooltip
const EDGE = 10 // keep this far from the viewport edge

/**
 * The floating panel itself. Portalled to <body> because the schedule grids
 * scroll and clip their contents — a tooltip parented to a block would be cut
 * off at the edge of the track.
 */
export function TooltipPortal({ rect, children }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  // Measure first, then place: the tooltip's own height decides whether it
  // fits above the trigger, and its width decides how far it must be nudged
  // back from a viewport edge.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()

    const above = rect.top - GAP - height >= EDGE
    const top = above ? rect.top - GAP - height : rect.bottom + GAP

    let left = rect.left + rect.width / 2 - width / 2
    left = Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE))

    // The arrow tracks the trigger even after the body has been nudged.
    const arrow = Math.max(14, Math.min(rect.left + rect.width / 2 - left, width - 14))

    setPos({ top, left, above, arrow })
  }, [rect])

  return createPortal(
    <div
      ref={ref}
      className={'fd-tip' + (pos ? ' fd-tip-in' : '') + (pos?.above ? ' fd-tip-above' : '')}
      role="tooltip"
      style={
        pos
          ? { top: `${pos.top}px`, left: `${pos.left}px`, '--arrow': `${pos.arrow}px` }
          : { top: 0, left: 0, visibility: 'hidden' }
      }
    >
      {children}
      <span className="fd-tip-arrow" />
    </div>,
    document.body,
  )
}

/* ---------------------------------------------------------------- content */

/** Title block: code above, full course name below. */
export function TipHead({ code, title }) {
  return (
    <div className="fd-tip-head">
      {code && <span className="fd-tip-code">{code}</span>}
      <span className="fd-tip-title">{title}</span>
    </div>
  )
}

/** One label/value line. Values wrap; labels never do. */
export function TipRow({ label, children }) {
  if (children === null || children === undefined || children === '') return null
  return (
    <div className="fd-tip-row">
      <span className="fd-tip-label">{label}</span>
      <span className="fd-tip-value">{children}</span>
    </div>
  )
}

export function TipNote({ tone = 'info', children }) {
  return <div className={`fd-tip-note fd-tip-note-${tone}`}>{children}</div>
}
