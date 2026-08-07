import { SCHOOLS, schoolName } from '../lib/schools.js'

/**
 * First step of the funnel: which school's timetable to load.
 *
 * Only schools that have actually published are offered, so a student is never
 * shown a dead end. Deliberately a full screen rather than another pill row in
 * the side panel — it decides which dataset gets downloaded, so it happens
 * before the builder mounts.
 */
export default function SchoolPicker({ published, onPick, what = 'timetable', onSkip }) {
  const known = SCHOOLS.filter((s) => published.includes(s.code))
  const unknown = published.filter((c) => !SCHOOLS.some((s) => s.code === c))

  return (
    <div
      className="fd-paper grid place-items-center px-6 py-14"
      style={{ minHeight: 'calc(100dvh - var(--nav-h))' }}
    >
      <div className="w-full max-w-2xl">
        <p
          className="mb-3 text-[11px] uppercase tracking-[0.18em]"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--acc)' }}
        >
          Step 1 of 4
        </p>
        <h1
          className="m-0 text-[clamp(1.6rem,4vw,2.3rem)] font-bold tracking-[-0.02em]"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--tx)' }}
        >
          Which school are you in?
        </h1>
        <p className="mt-3 mb-8 max-w-lg text-[14px] leading-relaxed" style={{ color: 'var(--tx-2)' }}>
          Each school publishes its own {what}. We&rsquo;ll remember your choice, so this is a
          one-time step.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {known.map((s, i) => (
            <button
              key={s.code}
              className="fd-school"
              onClick={() => onPick(s.code)}
              style={{ animation: 'drop .32s ease backwards', animationDelay: `${i * 0.04}s` }}
            >
              <span className="fd-school-code">{s.code}</span>
              <span className="fd-school-name">{s.name}</span>
            </button>
          ))}
          {unknown.map((code) => (
            <button key={code} className="fd-school" onClick={() => onPick(code)}>
              <span className="fd-school-code">{code}</span>
              <span className="fd-school-name">{schoolName(code)}</span>
            </button>
          ))}
        </div>

        {published.length === 0 && (
          <div className="fd-note fd-note-warn mt-6">
            No school has published a {what} yet.
          </div>
        )}

        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="mt-6 cursor-pointer border-0 bg-transparent p-0 text-[12.5px] underline-offset-4 hover:underline"
            style={{ color: 'var(--tx-3)' }}
          >
            Skip &mdash; I&rsquo;ll search for my courses instead
          </button>
        )}
      </div>
    </div>
  )
}
