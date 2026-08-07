import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { fetchAllMeta } from '../lib/datasets.js'
import { relativeTime } from '../lib/format.js'

const PRODUCTS = [
  {
    to: '/timetable',
    kind: 'timetable',
    name: 'Timetable',
    tagline: 'Build your week.',
    blurb:
      'Pick your programme, year and section. Add electives and repeats, watch for clashes, and export the whole week as an image.',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="4" width="18" height="17" rx="3" />
        <path d="M3 9h18M8 4V2m8 2V2M8 13h3m-3 4h3m5-4h1m-1 4h1" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/datesheet',
    kind: 'datesheet',
    name: 'Datesheet',
    tagline: 'Know your exams.',
    blurb:
      'Load your section to see exactly which exams you sit, on which day and in which slot — with same-slot clashes flagged.',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="4" width="18" height="17" rx="3" />
        <path d="M3 9h18M8 4V2m8 2V2" strokeLinecap="round" />
        <path d="m8.5 14.5 2.2 2.2 4.3-4.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
]

export default function Landing() {
  const [meta, setMeta] = useState({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchAllMeta()
      .then((rows) => {
        if (cancelled) return
        setMeta(Object.fromEntries(rows.map((r) => [r.kind, r])))
        setLoaded(true)
      })
      .catch(() => !cancelled && setLoaded(true))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="fd-paper" style={{ minHeight: 'calc(100dvh - var(--nav-h))' }}>
      <div className="mx-auto w-full max-w-5xl px-6 pt-16 pb-20 sm:pt-24">
        <p
          className="mb-4 text-[11px] uppercase tracking-[0.18em]"
          style={{ fontFamily: 'var(--font-mono)', color: 'var(--acc)' }}
        >
          FAST NUCES · Lahore
        </p>

        <h1
          className="m-0 max-w-3xl text-[clamp(2.1rem,6vw,3.6rem)] leading-[1.05] font-bold tracking-[-0.03em]"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--tx)' }}
        >
          Your semester,
          <br />
          <span style={{ color: 'var(--acc)' }}>on one screen.</span>
        </h1>

        <p
          className="mt-5 max-w-xl text-[15px] leading-relaxed"
          style={{ color: 'var(--tx-2)' }}
        >
          Stop scrolling a spreadsheet that lists every course in the university. Pick your
          section once and keep only what you actually take.
        </p>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {PRODUCTS.map((p) => {
            const m = meta[p.kind]
            return (
              <Link
                key={p.to}
                to={p.to}
                className="fd-tile group no-underline"
                style={{ animation: 'drop .4s ease backwards' }}
              >
                <span className="fd-tile-glyph">{p.glyph}</span>

                <span className="fd-tile-name">{p.name}</span>
                <span className="fd-tile-tagline">{p.tagline}</span>
                <span className="fd-tile-blurb">{p.blurb}</span>

                <span className="fd-tile-foot">
                  {!loaded ? (
                    <span style={{ color: 'var(--tx-3)' }}>Checking…</span>
                  ) : m ? (
                    <>
                      <span className="fd-tile-chip">{m.label}</span>
                      <span style={{ color: 'var(--tx-3)' }}>
                        updated {relativeTime(m.updated_at)}
                      </span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--tx-3)' }}>Nothing published yet</span>
                  )}
                </span>
              </Link>
            )
          })}
        </div>

        <p className="mt-14 text-[12.5px]" style={{ color: 'var(--tx-3)' }}>
          Everything is saved in your browser — no account needed.
        </p>
      </div>
    </div>
  )
}
