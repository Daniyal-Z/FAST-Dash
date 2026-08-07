import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { useAllMeta, useDataset } from '../hooks/useDataset.js'
import { useSchoolChoice } from '../hooks/useSchoolChoice.js'
import SchoolPicker from '../components/SchoolPicker.jsx'
import PanelToggle from '../components/PanelToggle.jsx'
import { usePanel } from '../hooks/usePanel.js'
import { TipHead, TipRow, TipNote } from '../components/Tooltip.jsx'
import { useTooltip } from '../hooks/useTooltip.jsx'
import { ALL_SCHOOLS, schoolShort } from '../lib/schools.js'
import {
  EmptyDatasetScreen,
  ErrorScreen,
  LoadingScreen,
  NotConfiguredScreen,
} from '../components/States.jsx'
import { normaliseCode } from '../lib/parsers/shared.js'

/* ============================================================
   Exam datesheet builder.

   The exam sheet itself only knows Day / Date / Slot / Code / Course — it has
   no programme, year or section columns. So to offer the same
   programme -> year -> section funnel as the timetable, this page joins the
   two datasets on course code: your section's courses come from the timetable,
   and their exam times come from the datesheet.

   When no timetable is published the funnel is hidden and search still works.
   ============================================================ */

const PROG_META = {
  BCS: 'Computer Science', BSE: 'Software Engineering', BDS: 'Data Science',
  BAI: 'Artificial Intelligence', BCY: 'Cyber Security',
  MCS: 'MS Computer Science', MSP: 'MS Project Mgmt', MDS: 'MS Data Science',
  MCY: 'MS Cyber Security', MCI: 'MS Computational Intel.',
}
const PROG_ORDER = ['BCS', 'BSE', 'BDS', 'BAI', 'BCY', 'MCS', 'MSP', 'MDS', 'MCY', 'MCI']
const YEAR_LABEL = { 1: 'Year 1', 2: 'Year 2', 3: 'Year 3', 4: 'Year 4', 5: 'Year 5' }
const SEM_OF = { 1: '1st sem', 2: '2nd', 3: '3rd sem', 4: '4th', 5: '5th sem', 6: '6th', 7: '7th sem', 8: '8th', 9: '9th sem' }

const STORAGE_KEY = 'fastdash:datesheet:selected'
const SCHOOL_KEY = 'fastdash:timetable:school'

/**
 * The datesheet itself is university-wide — one sheet covering every school's
 * courses. What is per-school is the *timetable* it borrows the
 * programme/year/section funnel from, so the school step decides which
 * timetable to download, not which datesheet.
 *
 * The school key is shared with the Timetable page on purpose: a student is in
 * one school, and should not have to say so twice.
 */
export default function Datesheet() {
  const meta = useAllMeta()
  const { school, setSchool, published } = useSchoolChoice(SCHOOL_KEY, meta, 'timetable')
  const [skipped, setSkipped] = useState(false)

  const ds = useDataset('datesheet', ALL_SCHOOLS)
  const tt = useDataset('timetable', skipped ? null : school)

  if (meta.status === 'unconfigured') return <NotConfiguredScreen />
  if (meta.status === 'loading' || ds.status === 'loading') return <LoadingScreen what="datesheet" />
  if (ds.status === 'empty') return <EmptyDatasetScreen what="datesheet" />
  if (ds.status === 'error') return <ErrorScreen error={ds.error} onRetry={ds.refresh} />

  // Ask which school only when there is a timetable to load. Without one the
  // page still works — you just search for your courses instead.
  if (published.length > 0 && !school && !skipped) {
    return (
      <SchoolPicker
        published={published}
        onPick={setSchool}
        what="timetable"
        onSkip={() => setSkipped(true)}
      />
    )
  }
  if (!skipped && school && (tt.status === 'idle' || tt.status === 'loading')) {
    return <LoadingScreen what="datesheet" />
  }

  return (
    <DatesheetBuilder
      key={school || 'search'}
      data={ds.data}
      label={ds.label}
      timetable={skipped ? null : tt.data}
      school={skipped ? null : school}
      onChangeSchool={() => { setSkipped(false); setSchool(null) }}
      canChangeSchool={published.length > 0}
    />
  )
}

function DatesheetBuilder({ data, label, timetable, school, onChangeSchool, canChangeSchool }) {
  const { slots, dates, exams, courses } = data
  const offerings = timetable?.offerings ?? null

  const [selected, setSelected] = useState(() => new Set())
  const [ready, setReady] = useState(false)
  const [prog, setProg] = useState(null)
  const [year, setYear] = useState(null)
  const [section, setSection] = useState(null)
  const [tab, setTab] = useState('main')
  const [query, setQuery] = useState('')
  const [view, setView] = useState('list') // list | grid
  const [pngPreview, setPngPreview] = useState(null)
  const { bind, tooltip } = useTooltip()
  const panel = usePanel()

  const exportFilename =
    'Datesheet_' + (label || 'datesheet').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') + '.png'

  /* ---------- persistence ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setSelected(new Set(JSON.parse(raw)))
    } catch (e) { /* first run */ }
    setReady(true)
  }, [])
  useEffect(() => {
    if (!ready) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...selected])) } catch (e) {}
  }, [selected, ready])

  /* ---------- indexes ---------- */

  // Every exam sitting for a given course code. Normally one, but a course can
  // legitimately appear twice (e.g. a lecture and its lab paper).
  const examsByCode = useMemo(() => {
    const m = new Map()
    for (const e of exams) {
      const key = normaliseCode(e.code)
      if (!key) continue
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(e)
    }
    return m
  }, [exams])

  const nameByCode = useMemo(() => {
    const m = new Map()
    for (const c of courses) m.set(normaliseCode(c.code), c.name)
    // The timetable has fuller titles for anything the datesheet abbreviates.
    if (offerings) {
      for (const o of offerings) {
        const k = normaliseCode(o.code)
        if (k && !m.has(k)) m.set(k, o.title || o.course)
      }
    }
    return m
  }, [courses, offerings])

  /* ---------- funnel (needs the timetable) ---------- */

  const progList = useMemo(() => {
    if (!offerings) return []
    const present = new Set(offerings.map((o) => o.prog))
    return PROG_ORDER.filter((p) => present.has(p))
  }, [offerings])

  const yearsForProg = useMemo(() => {
    if (!offerings || !prog) return []
    const ys = new Set()
    offerings.forEach((o) => { if (o.prog === prog && o.year) ys.add(o.year) })
    return [...ys].sort((a, b) => a - b)
  }, [offerings, prog])

  const sectionsForYear = useMemo(() => {
    if (!offerings || !prog || !year) return []
    const s = new Set()
    offerings.forEach((o) => {
      if (o.prog === prog && o.year === year && o.bucket === 'main' && o.primSection) s.add(o.primSection)
    })
    return [...s].sort()
  }, [offerings, prog, year])

  /** Distinct course codes from a set of offerings, with a display name. */
  const codesOf = useCallback((list) => {
    const seen = new Map()
    for (const o of list) {
      const key = normaliseCode(o.code)
      if (!key || seen.has(key)) continue
      seen.set(key, { code: key, name: o.title || o.course, section: o.section })
    }
    return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code))
  }, [])

  const mainBundle = useMemo(() => {
    if (!offerings || !section) return []
    return codesOf(offerings.filter((o) =>
      o.bucket === 'main' && (o.primSection === section || (!o.primSection && o.prog === prog && o.year === year)),
    ))
  }, [offerings, section, prog, year, codesOf])

  const additionalBundle = useMemo(() => {
    if (!offerings || !prog || !year) return []
    return codesOf(offerings.filter((o) => o.bucket === 'repeat' && o.prog === prog && o.year === year))
  }, [offerings, prog, year, codesOf])

  const electiveBundle = useMemo(() => {
    if (!offerings || !prog || !year) return []
    return codesOf(offerings.filter((o) => o.bucket === 'elective' && o.prog === prog && o.year === year))
  }, [offerings, prog, year, codesOf])

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return courses
      .filter((c) => c.code.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q))
      .slice(0, 40)
      .map((c) => ({ code: normaliseCode(c.code), name: c.name }))
  }, [query, courses])

  /* ---------- selection -> schedule ---------- */

  const selectedExams = useMemo(() => {
    const out = []
    for (const code of selected) {
      for (const e of examsByCode.get(code) ?? []) out.push(e)
    }
    return out
  }, [selected, examsByCode])

  /** Selected courses that have no exam in this datesheet at all. */
  const noExam = useMemo(
    () => [...selected].filter((c) => !examsByCode.has(c)).sort(),
    [selected, examsByCode],
  )

  // date -> slot -> exams, for both views.
  const byDate = useMemo(() => {
    const m = new Map()
    for (const e of selectedExams) {
      const key = e.iso || e.date
      if (!m.has(key)) m.set(key, { date: e.date, iso: e.iso, day: e.day, slots: new Map() })
      const bucket = m.get(key).slots
      if (!bucket.has(e.slot)) bucket.set(e.slot, [])
      bucket.get(e.slot).push(e)
    }
    const order = new Map(dates.map((d, i) => [d.iso || d.date, i]))
    return [...m.values()].sort((a, b) => {
      const ai = order.get(a.iso || a.date) ?? 1e9
      const bi = order.get(b.iso || b.date) ?? 1e9
      return ai - bi
    })
  }, [selectedExams, dates])

  const clashes = useMemo(() => {
    let n = 0
    for (const d of byDate) for (const [, list] of d.slots) if (list.length > 1) n++
    return n
  }, [byDate])

  /* ---------- actions ---------- */
  const toggle = useCallback((code) => setSelected((prev) => {
    const next = new Set(prev)
    next.has(code) ? next.delete(code) : next.add(code)
    return next
  }), [])
  const addMany = useCallback((list) => setSelected((prev) => {
    const next = new Set(prev); list.forEach((c) => next.add(c.code)); return next
  }), [])
  const removeMany = useCallback((list) => setSelected((prev) => {
    const next = new Set(prev); list.forEach((c) => next.delete(c.code)); return next
  }), [])
  const clearAll = () => setSelected(new Set())

  const pickProg = (p) => { setProg(p); setYear(null); setSection(null); setTab('main') }
  const pickYear = (y) => { setYear(y); setSection(null) }

  /* ---------- PNG export ---------- */
  const downloadPNG = useCallback(() => {
    const scale = 2
    const W = 760, pad = 24, titleH = 66
    const rowH = 46, dateH = 34
    let H = pad * 2 + titleH
    for (const d of byDate) {
      H += dateH
      for (const [, list] of d.slots) H += rowH * list.length
    }
    if (noExam.length) H += 30 + Math.ceil(noExam.length / 3) * 20
    H = Math.max(H, 220)

    const cv = document.createElement('canvas')
    cv.width = W * scale; cv.height = H * scale
    const ctx = cv.getContext('2d'); ctx.scale(scale, scale)

    ctx.fillStyle = '#0f1220'; ctx.fillRect(0, 0, W, H)
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#e8eaf2'; ctx.font = "700 24px 'Space Grotesk', sans-serif"
    ctx.fillText('Your Exams', pad, pad + 18)
    ctx.fillStyle = '#7c9cff'; ctx.font = "600 13px 'JetBrains Mono', monospace"
    ctx.fillText((label || 'Datesheet').toUpperCase(), pad, pad + 42)

    let y = pad + titleH
    for (const d of byDate) {
      ctx.fillStyle = '#1c2033'
      roundRect(ctx, pad, y, W - pad * 2, dateH - 6, 8); ctx.fill()
      ctx.fillStyle = '#e8eaf2'; ctx.font = "700 13px 'Space Grotesk', sans-serif"
      ctx.fillText(`${d.day ?? ''}  ${d.date}`.trim(), pad + 12, y + (dateH - 6) / 2)
      y += dateH

      for (const [slot, list] of d.slots) {
        for (const e of list) {
          const clash = list.length > 1
          ctx.fillStyle = clash ? 'rgba(255,107,129,.10)' : '#171a2b'
          roundRect(ctx, pad, y, W - pad * 2, rowH - 6, 8); ctx.fill()
          if (clash) { ctx.fillStyle = '#ff6b81'; roundRect(ctx, pad, y, 3, rowH - 6, 2); ctx.fill() }

          ctx.fillStyle = '#9aa0b5'; ctx.font = "600 11px 'JetBrains Mono', monospace"
          ctx.fillText(slot, pad + 14, y + (rowH - 6) / 2)
          ctx.fillStyle = '#7c9cff'; ctx.font = "600 12px 'JetBrains Mono', monospace"
          ctx.fillText(e.code, pad + 132, y + (rowH - 6) / 2)
          ctx.fillStyle = '#e8eaf2'; ctx.font = "500 13px 'Space Grotesk', sans-serif"
          ctx.fillText(trunc(ctx, e.name, W - pad * 2 - 230), pad + 210, y + (rowH - 6) / 2)
          y += rowH
        }
      }
    }

    if (noExam.length) {
      y += 8
      ctx.fillStyle = '#6b7189'; ctx.font = "600 11px 'JetBrains Mono', monospace"
      ctx.fillText('SELECTED · NO EXAM SCHEDULED', pad, y); y += 18
      ctx.fillStyle = '#9aa0b5'; ctx.font = "500 12px 'Space Grotesk', sans-serif"
      noExam.forEach((code, i) => {
        const col = i % 3, row = Math.floor(i / 3)
        ctx.fillText(code, pad + col * ((W - pad * 2) / 3), y + row * 20)
      })
    }

    let url
    try { url = cv.toDataURL('image/png') } catch (e) { url = null }
    if (url) {
      setPngPreview(url)
      try {
        const a = document.createElement('a')
        a.href = url; a.download = exportFilename
        document.body.appendChild(a); a.click(); a.remove()
      } catch (e) { /* preview modal covers this */ }
    }
  }, [byDate, noExam, label, exportFilename])

  const activeList = tab === 'main' ? mainBundle : tab === 'additional' ? additionalBundle : electiveBundle
  const allActiveSelected = activeList.length > 0 && activeList.every((c) => selected.has(c.code))
  const searching = query.trim().length >= 2

  return (
    <div className={"fsc-root" + (panel.open ? "" : " panel-collapsed")}>
      {/* ============ LEFT CONTROL PANEL ============ */}
      <aside className="panel">
        <header className="brand">
          <div className="brand-mark">EX</div>
          <div>
            <div className="brand-title">Datesheet</div>
            <div className="brand-sub">{label || 'Exams'}</div>
          </div>
          <PanelToggle open={panel.open} onToggle={panel.toggle} />
        </header>

        <div className="search">
          <svg viewBox="0 0 24 24" className="search-i">
            <path d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search any course or code…" />
          {query && <button className="search-x" onClick={() => setQuery('')}>×</button>}
        </div>

        {searching ? (
          <div className="results">
            <div className="results-h">{searchResults.length} match{searchResults.length !== 1 ? 'es' : ''}</div>
            <div className="scroll">
              {searchResults.map((c) => (
                <CourseRow key={c.code} c={c} on={selected.has(c.code)} toggle={toggle} exams={examsByCode.get(c.code)} />
              ))}
              {searchResults.length === 0 && <div className="empty">Nothing found. Try a shorter term.</div>}
            </div>
          </div>
        ) : !offerings ? (
          <div className="hint">
            No timetable has been published yet, so sections aren’t available here. Search for your
            courses by name or code above and they’ll be added to your schedule.
          </div>
        ) : (
          <>
            <div className="funnel">
              <div className="crumbs">
                {canChangeSchool && school && (
                  <button className="crumb" onClick={onChangeSchool} title="Change school">
                    <b>{school}</b><i>{schoolShort(school)}</i><span className="crumb-x">↻</span>
                  </button>
                )}
                {canChangeSchool && school && (prog || year || section) && <span className="crumb-sep">▸</span>}
                {prog && <button className="crumb" onClick={() => pickProg(null)}><b>{prog}</b><i>{PROG_META[prog] || prog}</i><span className="crumb-x">↻</span></button>}
                {year && <><span className="crumb-sep">▸</span><button className="crumb" onClick={() => pickYear(null)}><b>{YEAR_LABEL[year]}</b><span className="crumb-x">↻</span></button></>}
                {section && <><span className="crumb-sep">▸</span><button className="crumb crumb-sec" onClick={() => setSection(null)}><b>{section}</b><span className="crumb-x">↻</span></button></>}
              </div>

              {!prog && (
                <Level label="Choose your program">
                  <div className="pills">
                    {progList.map((p) => (
                      <button key={p} className="pill" onClick={() => pickProg(p)}>
                        <span className="pill-code">{p}</span>
                        <span className="pill-name">{PROG_META[p]}</span>
                      </button>
                    ))}
                  </div>
                </Level>
              )}

              {prog && !year && (
                <Level label="Which year?">
                  <div className="pills pills-year">
                    {yearsForProg.map((y) => (
                      <button key={y} className="pill pill-yr" onClick={() => pickYear(y)}>
                        <span className="pill-code">{YEAR_LABEL[y]}</span>
                        <span className="pill-name">{SEM_OF[y * 2 - 1]}</span>
                      </button>
                    ))}
                  </div>
                </Level>
              )}

              {prog && year && !section && (
                <Level label="Pick your section">
                  <div className="pills pills-sec">
                    {sectionsForYear.map((s) => (
                      <button key={s} className="pill pill-s" onClick={() => setSection(s)}>{s}</button>
                    ))}
                    {sectionsForYear.length === 0 && <div className="empty">No sections listed for this year.</div>}
                  </div>
                </Level>
              )}
            </div>

            {prog && (
              <div className="bundles">
                <div className="tabs">
                  <button className={'tab' + (tab === 'main' ? ' on' : '')} onClick={() => setTab('main')} disabled={!section}>
                    Main {section && <span className="tab-n">{mainBundle.length}</span>}
                  </button>
                  <button className={'tab' + (tab === 'additional' ? ' on' : '')} onClick={() => setTab('additional')} disabled={!year}>
                    Additional {year && <span className="tab-n">{additionalBundle.length}</span>}
                  </button>
                  <button className={'tab' + (tab === 'electives' ? ' on' : '')} onClick={() => setTab('electives')} disabled={!year}>
                    Electives {year && <span className="tab-n">{electiveBundle.length}</span>}
                  </button>
                </div>

                {tab === 'main' && !section && <div className="hint">Pick a section above to load its courses.</div>}
                {tab !== 'main' && !year && <div className="hint">Pick a year above first.</div>}

                {activeList.length > 0 && (
                  <div className="bundle-bar">
                    <span className="bundle-title">{activeList.length} course{activeList.length !== 1 ? 's' : ''}</span>
                    {allActiveSelected
                      ? <button className="bundle-btn off" onClick={() => removeMany(activeList)}>Remove all</button>
                      : <button className="bundle-btn" onClick={() => addMany(activeList)}>+ Add all</button>}
                  </div>
                )}

                <div className="scroll bundle-scroll">
                  {activeList.map((c) => (
                    <CourseRow key={c.code} c={c} on={selected.has(c.code)} toggle={toggle} exams={examsByCode.get(c.code)} />
                  ))}
                  {tab !== 'main' && year && activeList.length === 0 && (
                    <div className="empty">Nothing listed for {prog} · {YEAR_LABEL[year]}.</div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </aside>

      {/* ============ RIGHT: SCHEDULE ============ */}
      <main className="stage">
        <div className="stage-bar">
          {!panel.open && <PanelToggle open={false} onToggle={panel.toggle} />}
          <div className="stage-title">
            <h1>Your Exams</h1>
            <div className="stage-meta">
              <span className="chip-n">{selectedExams.length}</span>
              exam{selectedExams.length !== 1 ? 's' : ''}
              {clashes > 0 && <span className="clash">⚠ {clashes} clash{clashes !== 1 ? 'es' : ''}</span>}
            </div>
          </div>
          <div className="stage-actions">
            <button
              className="ghost"
              onClick={() => setView(view === 'list' ? 'grid' : 'list')}
              disabled={!selectedExams.length}
            >
              {view === 'list' ? 'Grid view' : 'List view'}
            </button>
            <button className="ghost" onClick={clearAll} disabled={!selected.size}>Clear</button>
            <button className="primary" onClick={downloadPNG} disabled={!selectedExams.length}>
              <svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Download PNG
            </button>
          </div>
        </div>

        {noExam.length > 0 && (
          <div className="enrolled">
            <span className="enrolled-label">Selected · no exam scheduled</span>
            <div className="enrolled-chips">
              {noExam.map((code) => (
                <span key={code} className="echip" style={{ background: 'var(--panel-2)', color: 'var(--tx-2)' }}
                  title={nameByCode.get(code) || code}>
                  <b>{code}</b>{nameByCode.get(code) || ''}
                  <button className="echip-x" onClick={() => toggle(code)} aria-label="Remove">×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="grid-wrap">
          {selectedExams.length === 0 ? (
            <div className="stage-empty">
              <div className="stage-empty-glyph">◱</div>
              <p>No exams yet.</p>
              <span>
                {offerings
                  ? 'Choose your programme, year and section on the left — or search for individual courses. Only the exams you actually sit will show up here.'
                  : 'Search for your courses on the left and their exam times will appear here.'}
              </span>
            </div>
          ) : view === 'list' ? (
            <div className="ds-list">
              {byDate.map((d) => (
                <section key={d.iso || d.date} className="ds-day">
                  <header className="ds-day-head">
                    <span className="ds-day-name">{d.day}</span>
                    <span className="ds-day-date">{d.date}</span>
                  </header>
                  {[...d.slots.entries()].map(([slot, list]) => (
                    <React.Fragment key={slot}>
                      {list.map((e) => (
                        <div
                          key={e.code + slot}
                          className={'ds-row' + (list.length > 1 ? ' ds-row-clash' : '')}
                          tabIndex={0}
                          {...bind(<ExamTip exam={e} day={d} clash={list.length > 1} others={list} />)}
                        >
                          <span className="ds-slot">{slot}</span>
                          <span className="ds-code">{e.code}</span>
                          <span className="ds-name">{e.name}</span>
                          {list.length > 1 && <span className="ds-flag">clash</span>}
                          <button className="ds-x" onClick={() => toggle(normaliseCode(e.code))} aria-label="Remove">×</button>
                        </div>
                      ))}
                    </React.Fragment>
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <div className="grid-scroll">
              <div className="grid" style={{ gridTemplateColumns: `150px repeat(${slots.length}, minmax(170px, 1fr))` }}>
                <div className="gh gh-corner"><span>DATE</span><span className="corner-slash">/</span><span>SLOT</span></div>
                {slots.map((s) => <div key={s} className="gh gh-time">{s}</div>)}
                {byDate.map((d) => (
                  <React.Fragment key={d.iso || d.date}>
                    <div className="gh gh-day ds-gh-day">
                      <span>{d.day}</span>
                      <span className="ds-gh-date">{d.date}</span>
                    </div>
                    {slots.map((s) => {
                      const list = d.slots.get(s) ?? []
                      return (
                        <div key={s} className={'cell' + (list.length > 1 ? ' cell-clash' : '')}>
                          {list.map((e) => (
                            <div
                              key={e.code}
                              className="block ds-block"
                              tabIndex={0}
                              {...bind(<ExamTip exam={e} day={d} clash={list.length > 1} others={list} />)}
                            >
                              <span className="block-spine" style={{ background: 'var(--acc)' }} />
                              <div className="block-eyebrow">{e.code}</div>
                              <div className="block-code">{e.name}</div>
                              <button className="block-x" onClick={() => toggle(normaliseCode(e.code))} aria-label="Remove">×</button>
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="source-note">Course titles, teachers, rooms and timings are shown as published by FAST NUCES. Any errors originate in the official sheet.</p>
      </main>

      {tooltip}

      {pngPreview && (
        <div className="modal" onClick={() => setPngPreview(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>Datesheet image</span>
              <button className="modal-x" onClick={() => setPngPreview(null)} aria-label="Close">×</button>
            </div>
            <div className="modal-body"><img src={pngPreview} alt="Your exam schedule" className="modal-img" /></div>
            <div className="modal-foot">
              <a className="primary" href={pngPreview} download={exportFilename}>Save image</a>
              <span className="modal-hint">If the download didn’t start, right-click (or long-press) the image to save it.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Level({ label, children }) {
  return <div className="level"><div className="level-label">{label}</div>{children}</div>
}

function CourseRow({ c, on, toggle, exams }) {
  const has = Boolean(exams?.length)
  return (
    <button className={'crow' + (on ? ' on' : '')} onClick={() => toggle(c.code)}>
      <span
        className="crow-swatch"
        style={{
          background: has ? 'rgba(124,156,255,.14)' : 'rgba(255,255,255,.05)',
          color: has ? 'var(--acc-2)' : 'var(--tx-3)',
        }}
      >
        {has ? exams.length : '—'}
      </span>
      <span className="crow-main">
        <span className="crow-name">{c.name || c.code}</span>
        <span className="crow-sub">
          {c.code}
          {has ? ` · ${exams[0].date} · ${exams[0].slot}` : ' · no exam scheduled'}
        </span>
      </span>
      <span className={'crow-tick' + (on ? ' on' : '')}>{on ? '✓' : '+'}</span>
    </button>
  )
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}
function trunc(ctx, s, max) {
  if (ctx.measureText(s).width <= max) return s
  let t = s
  while (t.length && ctx.measureText(t + '…').width > max) t = t.slice(0, -1)
  return t + '…'
}

/** Hover detail for an exam. The row truncates long course names; this does not. */
function ExamTip({ exam, day, clash, others }) {
  const clashing = others.filter(o => o.code !== exam.code)
  return (
    <>
      <TipHead code={exam.code} title={exam.name} />
      <TipRow label="Day">{day?.day ?? exam.day}</TipRow>
      <TipRow label="Date"><b>{exam.date}</b></TipRow>
      <TipRow label="Slot"><b>{exam.slot}</b></TipRow>
      {clash && clashing.length > 0 && (
        <TipNote tone="warn">
          Same slot as {clashing.map(o => o.code).join(', ')}.
        </TipNote>
      )}
    </>
  )
}
