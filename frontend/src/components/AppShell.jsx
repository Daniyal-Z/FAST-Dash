import { NavLink, Outlet } from 'react-router'

const links = [
  { to: '/timetable', label: 'Timetable' },
  { to: '/datesheet', label: 'Datesheet' },
]

export default function AppShell() {
  return (
    <>
      <nav className="fd-nav">
        <NavLink
          to="/"
          className="flex items-center gap-2.5 no-underline"
          style={{ color: 'var(--tx)' }}
        >
          <span className="fd-mark">FD</span>
          <span
            className="hidden text-[15px] font-bold tracking-tight sm:block"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            FAST-Dash
          </span>
        </NavLink>

        <div className="flex flex-1 items-center gap-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => 'fd-navlink' + (isActive ? ' on' : '')}
            >
              {l.label}
            </NavLink>
          ))}
        </div>

        <NavLink
          to="/admin"
          className={({ isActive }) => 'fd-navlink' + (isActive ? ' on' : '')}
        >
          Admin
        </NavLink>
      </nav>

      <Outlet />
    </>
  )
}
