/**
 * Collapses and reopens the course panel.
 *
 * Rendered twice: inside the panel header while it is open, and at the left of
 * the stage bar once it is closed — because a control that lives only inside
 * the panel disappears along with it, leaving no way back.
 *
 * The icon changes with the layout, because the motion does. On a wide screen
 * the panel is a sidebar that slides sideways, so it gets a sidebar glyph. On a
 * narrow one the panel sits above the schedule and folds upwards, so it gets a
 * chevron that points the way it is about to move. Which icon shows is left to
 * CSS, so there is no media query in JavaScript to keep in step with the one in
 * the stylesheet.
 */
export default function PanelToggle({ open, onToggle, className = '' }) {
  return (
    <button
      type="button"
      className={'fd-panel-toggle ' + (open ? 'is-open ' : 'is-closed ') + className}
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? 'Collapse the course panel' : 'Show the course panel'}
      title={open ? 'Collapse panel' : 'Show panel'}
    >
      {/* wide: a sidebar that slides away to the left */}
      <svg className="fd-toggle-wide" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
        <line x1="9.5" y1="4.5" x2="9.5" y2="19.5" />
        {open && (
          <rect x="3.9" y="5.4" width="4.7" height="13.2" rx="1.6" fill="currentColor" stroke="none" opacity="0.5" />
        )}
      </svg>

      {/* narrow: a drawer that folds up, and drops back down */}
      <svg className="fd-toggle-narrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 14 6-6 6 6" />
      </svg>
    </button>
  )
}
