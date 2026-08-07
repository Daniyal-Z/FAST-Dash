/**
 * Collapses and reopens the course panel.
 *
 * Rendered twice: inside the panel header while it is open, and at the left of
 * the stage bar once it is closed — because a control that lives only inside
 * the panel disappears along with it, leaving no way back.
 */
export default function PanelToggle({ open, onToggle, className = '' }) {
  return (
    <button
      type="button"
      className={'fd-panel-toggle ' + className}
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? 'Collapse the course panel' : 'Show the course panel'}
      title={open ? 'Collapse panel' : 'Show panel'}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
        <line x1="9.5" y1="4.5" x2="9.5" y2="19.5" />
        {/* Filled leaf shows at a glance which way the toggle will go. */}
        {open && <rect x="3.9" y="5.4" width="4.7" height="13.2" rx="1.6" fill="currentColor" stroke="none" opacity="0.5" />}
      </svg>
    </button>
  )
}
