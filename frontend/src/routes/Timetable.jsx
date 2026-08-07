import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useAllMeta, useDataset } from "../hooks/useDataset.js";
import { useSchoolChoice } from "../hooks/useSchoolChoice.js";
import SchoolPicker from "../components/SchoolPicker.jsx"
import PanelToggle from "../components/PanelToggle.jsx"
import { usePanel } from "../hooks/usePanel.js";
import { TipHead, TipRow, TipNote } from "../components/Tooltip.jsx";
import { useTooltip } from "../hooks/useTooltip.jsx";
import { schoolShort } from "../lib/schools.js";
import {
  EmptyDatasetScreen,
  ErrorScreen,
  LoadingScreen,
  NotConfiguredScreen,
} from "../components/States.jsx";

/* ============================================================
   FSC Timetable Builder

   The schedule itself is published by an administrator and loaded at runtime,
   so nothing here is tied to a particular semester. The interaction model —
   programme -> year -> section, three course buckets, clash detection and the
   canvas PNG export — is unchanged from the original build.
   ============================================================ */

const PROG_META = {
  BCS: "Computer Science", BSE: "Software Engineering", BDS: "Data Science",
  BAI: "Artificial Intelligence", BCY: "Cyber Security",
  MCS: "MS Computer Science", MSP: "MS Project Mgmt", MDS: "MS Data Science",
  MCY: "MS Cyber Security", MCI: "MS Computational Intel.",
};
const PROG_ORDER = ["BCS", "BSE", "BDS", "BAI", "BCY", "MCS", "MSP", "MDS", "MCY", "MCI"];
const YEAR_LABEL = { 1: "Year 1", 2: "Year 2", 3: "Year 3", 4: "Year 4", 5: "Year 5" };
const SEM_OF = { 1: "1st sem", 2: "2nd", 3: "3rd sem", 4: "4th", 5: "5th sem", 6: "6th", 7: "7th sem", 8: "8th", 9: "9th sem" };

const STORAGE_KEY = "fastdash:timetable:selected";
const SCHOOL_KEY = "fastdash:timetable:school";

/** Height of one lane: the block itself plus the gap beneath it. */
const LANE_H = 84;

/* Minimum width per period band. Sized so that the longest line a block
   carries — "Instructor · 10:00-11:20" — still fits in the common case of an
   80-minute class, which occupies only ~89% of its band. Blocks ellipsize
   rather than wrap, and this grid gets screenshotted, so a truncated end time
   would follow people into their saved images. */
const MIN_BAND_W = 178;

function hhmmToMin(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Route entry point: choose a school, load that school's timetable, then hand
 * off to the builder. The school is picked before anything is downloaded, so a
 * visitor only ever fetches the one dataset they need.
 */
export default function Timetable() {
  const meta = useAllMeta();
  const { school, setSchool, published } = useSchoolChoice(SCHOOL_KEY, meta, "timetable");
  const ds = useDataset("timetable", school);

  if (meta.status === "unconfigured") return <NotConfiguredScreen />;
  if (meta.status === "loading") return <LoadingScreen what="timetable" />;
  if (meta.status === "error") return <ErrorScreen error={meta.error} />;
  if (published.length === 0) return <EmptyDatasetScreen what="timetable" />;
  if (!school) return <SchoolPicker published={published} onPick={setSchool} what="timetable" />;

  if (ds.status === "idle" || ds.status === "loading") return <LoadingScreen what="timetable" />;
  if (ds.status === "empty") return <EmptyDatasetScreen what="timetable" />;
  if (ds.status === "error") return <ErrorScreen error={ds.error} onRetry={ds.refresh} />;

  return (
    <TimetableBuilder
      key={school}
      data={ds.data}
      label={ds.label}
      school={school}
      onChangeSchool={() => setSchool(null)}
      canChangeSchool={published.length > 1}
    />
  );
}

function TimetableBuilder({ data, label, school, onChangeSchool, canChangeSchool }) {
  const { days, periods, offerings } = data;

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [prog, setProg] = useState(null);
  const [year, setYear] = useState(null);
  const [section, setSection] = useState(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("main"); // main | additional | electives
  const [ready, setReady] = useState(false);
  const [pngPreview, setPngPreview] = useState(null);
  const { bind, tooltip } = useTooltip()
  const panel = usePanel();

  // Everything the export writes is driven by the published label, so the
  // image never claims to be a semester it isn't.
  const exportSubtitle = (label || "Timetable").toUpperCase();
  const exportFilename =
    "Timetable_" + (label || "timetable").replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") + ".png";

  /* ---------- persistence ----------
     Keyed by school: offering ids are only unique within one school's
     workbook, so a single shared key would mix two schools' selections. */
  const storageKey = `${STORAGE_KEY}:${school}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setSelectedIds(raw ? new Set(JSON.parse(raw)) : new Set());
    } catch (e) { /* first run, or storage unavailable */ }
    setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(storageKey, JSON.stringify([...selectedIds])); } catch (e) {}
  }, [selectedIds, ready, storageKey]);

  // Drop selections that are no longer in the published data, so a stale
  // localStorage entry from last semester cannot pin invisible courses.
  useEffect(() => {
    if (!ready) return;
    const valid = new Set(offerings.map(o => o.id));
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [ready, offerings]);

  /* ---------- derived indexes ---------- */
  const progList = useMemo(() => {
    const present = new Set(offerings.map(o => o.prog));
    return PROG_ORDER.filter(p => present.has(p));
  }, [offerings]);

  const yearsForProg = useMemo(() => {
    if (!prog) return [];
    const ys = new Set();
    offerings.forEach(o => { if (o.prog === prog && o.year) ys.add(o.year); });
    return [...ys].sort((a, b) => a - b);
  }, [prog, offerings]);

  const sectionsForYear = useMemo(() => {
    if (!prog || !year) return [];
    const s = new Set();
    offerings.forEach(o => { if (o.prog === prog && o.year === year && o.bucket === "main" && o.primSection) s.add(o.primSection); });
    return [...s].sort();
  }, [prog, year, offerings]);

  // Main = current-semester courses for your exact section (the sheet's batch block),
  // plus batch-wide main courses that carry no section (e.g. Professional Practices, FYP).
  const mainBundle = useMemo(() => {
    if (!section) return [];
    return offerings.filter(o => o.bucket === "main" && (o.primSection === section || (!o.primSection && o.prog === prog && o.year === year)));
  }, [section, prog, year, offerings]);

  // Additional = repeat courses for the whole program + year (not bound to a section).
  const additionalBundle = useMemo(() => {
    if (!prog || !year) return [];
    return offerings.filter(o => o.bucket === "repeat" && o.prog === prog && o.year === year);
  }, [prog, year, offerings]);

  // Electives = electives offered to everyone in the program + year.
  const electiveBundle = useMemo(() => {
    if (!prog || !year) return [];
    return offerings.filter(o => o.bucket === "elective" && o.prog === prog && o.year === year);
  }, [prog, year, offerings]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return offerings.filter(o =>
      o.course.toLowerCase().includes(q) ||
      (o.title || "").toLowerCase().includes(q) ||
      (o.code || "").toLowerCase().includes(q) ||
      o.section.toLowerCase().includes(q) ||
      (o.instructor || "").toLowerCase().includes(q) ||
      o.meetings.some(m => m.room.toLowerCase().includes(q))
    ).slice(0, 40);
  }, [query, offerings]);

  /* ---------- grid ---------- */
  const selected = useMemo(() => offerings.filter(o => selectedIds.has(o.id)), [offerings, selectedIds]);
  const alsoEnrolled = useMemo(() => selected.filter(o => !o.meetings.length), [selected]);
  /* ---------- week layout ----------
     Laid out on a real time axis rather than in per-period cells.

     Cells cannot express a class that outlasts its slot: each one carries its
     own padding and border, so a block drawn across two of them is chopped in
     half by the gutter between them and has to be reassembled visually, which
     never quite works. Positioning by time instead means one class is one
     block, its left edge from when it starts and its width from how long it
     runs — so a 170-minute lab is simply a wider bar.

     Classes that genuinely overlap are stacked into lanes, which is also what
     makes a clash legible: two bars sitting on top of each other. */
  const axis = useMemo(() => {
    const from = hhmmToMin(periods[0].t.split("-")[0]);
    const to = hhmmToMin(periods[periods.length - 1].t.split("-")[1]);
    return { from, to, span: Math.max(1, to - from) };
  }, [periods]);

  const pct = useCallback(mins => ((mins - axis.from) / axis.span) * 100, [axis]);

  const bandBounds = useMemo(() => {
    const m = {};
    periods.forEach(p => {
      const [a, b] = p.t.split("-");
      m[p.p] = [hhmmToMin(a), hhmmToMin(b)];
    });
    return m;
  }, [periods]);

  const week = useMemo(() => {
    const byDay = {};
    let clashes = 0;

    days.forEach(day => {
      const items = [];
      selected.forEach(o => o.meetings.forEach(m => {
        if (m.day !== day) return;
        // Data published before durations were parsed has no start/end, so
        // fall back to the bounds of the bands it was recorded against.
        const span = Math.max(1, m.span || 1);
        const firstBand = bandBounds[m.period] ?? [axis.from, axis.from + 90];
        const lastBand = bandBounds[m.period + span - 1] ?? firstBand;
        const start = m.start ? hhmmToMin(m.start) : firstBand[0];
        const end = m.end ? hhmmToMin(m.end) : lastBand[1];
        items.push({ o, meeting: m, room: m.room, start, end: Math.max(end, start + 20) });
      }));

      items.sort((a, b) => a.start - b.start || a.end - b.end);

      // Lane packing: reuse the first lane whose previous class has finished.
      const laneEnds = [];
      items.forEach(it => {
        let lane = laneEnds.findIndex(end => end <= it.start);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
        laneEnds[lane] = it.end;
        it.lane = lane;
      });

      const pairs = new Set();
      items.forEach(a => items.forEach(b => {
        if (a === b || a.o.id === b.o.id) return;
        if (a.start < b.end && b.start < a.end) {
          pairs.add([a.o.id, b.o.id].sort().join("|"));
          a.clash = true;
        }
      }));
      clashes += pairs.size;

      byDay[day] = { items, lanes: Math.max(1, laneEnds.length) };
    });

    return { byDay, clashes };
  }, [selected, days, bandBounds, axis]);

  const conflicts = week.clashes;


  /* ---------- actions ---------- */
  const toggle = useCallback(id => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const addMany = useCallback(list => setSelectedIds(prev => { const n = new Set(prev); list.forEach(o => n.add(o.id)); return n; }), []);
  const removeMany = useCallback(list => setSelectedIds(prev => { const n = new Set(prev); list.forEach(o => n.delete(o.id)); return n; }), []);
  const clearAll = () => setSelectedIds(new Set());

  const pickProg = p => { setProg(p); setYear(null); setSection(null); setTab("main"); };
  const pickYear = y => { setYear(y); setSection(null); };

  /* ---------- download as PNG (canvas) ---------- */
  const downloadPNG = useCallback(() => {
    // Mirrors the on-screen layout: a time axis, not a column per period, so a
    // long class is drawn as one wide bar rather than several tiles.
    const scale = 2;
    const dayColW = 96, trackW = periods.length * 190, headerH = 54, pad = 22, titleH = 64;
    const laneH = 62, blockH = 54;

    const rowHeights = days.map(d => Math.max(66, week.byDay[d].lanes * laneH + 10));
    const gridW = dayColW + trackW;
    const gridH = headerH + rowHeights.reduce((a, b) => a + b, 0);
    const footH = alsoEnrolled.length ? 24 + Math.ceil(alsoEnrolled.length / 3) * 20 : 0;
    const W = gridW + pad * 2, H = titleH + gridH + footH + pad * 2;

    const cv = document.createElement("canvas"); cv.width = W * scale; cv.height = H * scale;
    const ctx = cv.getContext("2d"); ctx.scale(scale, scale);
    ctx.fillStyle = "#0f1220"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#e8eaf2"; ctx.font = "700 24px 'Space Grotesk', sans-serif"; ctx.textBaseline = "middle";
    ctx.fillText("The Lineup", pad, pad + 20);
    ctx.fillStyle = "#7c9cff"; ctx.font = "600 13px 'JetBrains Mono', monospace";
    ctx.fillText(exportSubtitle, pad, pad + 44);

    const gx = pad, gy = pad + titleH;
    const xOf = mins => gx + dayColW + ((mins - axis.from) / axis.span) * trackW;

    // header
    ctx.fillStyle = "#171a2b"; ctx.fillRect(gx, gy, gridW, headerH);
    ctx.font = "600 12px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
    periods.forEach(p => {
      const [from, to] = p.t.split("-");
      ctx.fillStyle = "#9aa0b5";
      ctx.fillText(p.t, (xOf(hhmmToMin(from)) + xOf(hhmmToMin(to))) / 2, gy + headerH / 2);
    });
    ctx.textAlign = "left";

    let yy = gy + headerH;
    days.forEach((d, di) => {
      const rh = rowHeights[di];
      ctx.fillStyle = "#141726"; ctx.fillRect(gx, yy, dayColW, rh);
      ctx.fillStyle = "#e8eaf2"; ctx.font = "700 16px 'Space Grotesk', sans-serif";
      ctx.fillText(d, gx + 16, yy + rh / 2);

      // band dividers, from the same axis as the blocks
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      periods.slice(1).forEach(p => {
        const x = xOf(bandBounds[p.p][0]);
        ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x, yy + rh); ctx.stroke();
      });

      week.byDay[d].items.forEach(it => {
        const bx = xOf(it.start) + 3;
        const bw = Math.max(34, xOf(it.end) - xOf(it.start) - 6);
        const by = yy + 6 + it.lane * laneH;
        roundRect(ctx, bx, by, bw, blockH, 8); ctx.fillStyle = it.o.bg; ctx.fill();
        if (it.clash) { ctx.strokeStyle = "#ff6b81"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1; }
        ctx.fillStyle = it.o.text; roundRect(ctx, bx, by, 4, blockH, 2); ctx.fill();

        const inner = bw - 20;
        ctx.fillStyle = it.o.text;
        ctx.font = "700 13px 'Space Grotesk', sans-serif";
        ctx.fillText(trunc(ctx, it.o.course, inner), bx + 12, by + 15);
        ctx.font = "500 10px 'JetBrains Mono', monospace";
        ctx.globalAlpha = 0.85;
        ctx.fillText(trunc(ctx, it.o.section + " \u00b7 " + it.room, inner), bx + 12, by + 30);
        const when = it.meeting.end ? `${it.meeting.start}\u2013${it.meeting.end}` : it.meeting.time;
        // Time drawn at a fixed right offset and the name truncated to
        // what is left, so an over-long instructor note can never eat it.
        const timeW = ctx.measureText(when).width;
        ctx.fillText(when, bx + bw - 12 - timeW, by + 44);
        ctx.fillText(trunc(ctx, it.o.instructor, Math.max(10, inner - timeW - 12)), bx + 12, by + 44);
        ctx.globalAlpha = 1;
      });

      yy += rh;
    });

    ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.strokeRect(gx, gy, gridW, gridH);

    if (alsoEnrolled.length) {
      let fy = gy + gridH + 20;
      ctx.textAlign = "left"; ctx.fillStyle = "#9aa0b5"; ctx.font = "600 11px 'JetBrains Mono', monospace";
      ctx.fillText("ALSO ENROLLED \u00b7 NO FIXED SLOT", gx, fy); fy += 18;
      ctx.font = "500 12px 'Space Grotesk', sans-serif"; ctx.fillStyle = "#e8eaf2";
      alsoEnrolled.forEach((o, i) => {
        const col = i % 3, rowi = Math.floor(i / 3);
        const label = (o.code ? o.code + " " : "") + o.course + " (" + (o.section !== "\u2014" ? o.section : o.prog) + ")";
        ctx.fillText(trunc(ctx, label, gridW / 3 - 20), gx + col * (gridW / 3), fy + rowi * 20);
      });
    }

    let url;
    try { url = cv.toDataURL("image/png"); } catch (e) { url = null; }
    if (url) {
      setPngPreview(url);
      try {
        const a = document.createElement("a");
        a.href = url; a.download = exportFilename;
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { /* preview modal covers it */ }
    }
  }, [week, days, periods, axis, bandBounds, alsoEnrolled, exportSubtitle, exportFilename]);

  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function trunc(ctx, s, max) { if (ctx.measureText(s).width <= max) return s; let t = s; while (t.length && ctx.measureText(t + "…").width > max) t = t.slice(0, -1); return t + "…"; }

  const activeList = tab === "main" ? mainBundle : tab === "additional" ? additionalBundle : electiveBundle;
  const allActiveSelected = activeList.length > 0 && activeList.every(o => selectedIds.has(o.id));

  /* ============================================================ */
  return (
    <div className={"fsc-root" + (panel.open ? "" : " panel-collapsed")}>
      {/* ============ LEFT CONTROL PANEL ============ */}
      <aside className="panel">
        <header className="brand">
          <div className="brand-mark">{school}</div>
          <div>
            <div className="brand-title">Timetable Builder</div>
            <div className="brand-sub">{label || "Timetable"}</div>
          </div>
          <PanelToggle open={panel.open} onToggle={panel.toggle} />
        </header>

        {/* search */}
        <div className="search">
          <svg viewBox="0 0 24 24" className="search-i"><path d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search any course, teacher, room…" />
          {query && <button className="search-x" onClick={() => setQuery("")}>×</button>}
        </div>

        {query.trim().length >= 2 ? (
          <div className="results">
            <div className="results-h">{searchResults.length} match{searchResults.length !== 1 ? "es" : ""}</div>
            <div className="scroll">
              {searchResults.map(o => <CourseRow key={o.id} o={o} on={selectedIds.has(o.id)} toggle={toggle} showSec />)}
              {searchResults.length === 0 && <div className="empty">Nothing found. Try a shorter term.</div>}
            </div>
          </div>
        ) : (
          <>
            {/* ---------- progressive funnel ---------- */}
            <div className="funnel">
              {/* breadcrumb of committed selections */}
              <div className="crumbs">
                {canChangeSchool && (
                  <button className="crumb" onClick={onChangeSchool} title="Change school">
                    <b>{school}</b><i>{schoolShort(school)}</i><span className="crumb-x">↻</span>
                  </button>
                )}
                {canChangeSchool && (prog || year || section) && <span className="crumb-sep">▸</span>}
                {prog && <button className="crumb" onClick={() => pickProg(null)}><b>{prog}</b><i>{PROG_META[prog] || prog}</i><span className="crumb-x">↻</span></button>}
                {year && <><span className="crumb-sep">▸</span><button className="crumb" onClick={() => pickYear(null)}><b>{YEAR_LABEL[year]}</b><span className="crumb-x">↻</span></button></>}
                {section && <><span className="crumb-sep">▸</span><button className="crumb crumb-sec" onClick={() => setSection(null)}><b>{section}</b><span className="crumb-x">↻</span></button></>}
              </div>

              {/* level: program */}
              {!prog && (
                <Level label="Choose your program">
                  <div className="pills">
                    {progList.map(p => (
                      <button key={p} className="pill" onClick={() => pickProg(p)}>
                        <span className="pill-code">{p}</span>
                        <span className="pill-name">{PROG_META[p]}</span>
                      </button>
                    ))}
                  </div>
                </Level>
              )}

              {/* level: year */}
              {prog && !year && (
                <Level label="Which year?">
                  <div className="pills pills-year">
                    {yearsForProg.map(y => (
                      <button key={y} className="pill pill-yr" onClick={() => pickYear(y)}>
                        <span className="pill-code">{YEAR_LABEL[y]}</span>
                        <span className="pill-name">{SEM_OF[y * 2 - 1]}</span>
                      </button>
                    ))}
                  </div>
                </Level>
              )}

              {/* level: section */}
              {prog && year && !section && (
                <Level label="Pick your section">
                  <div className="pills pills-sec">
                    {sectionsForYear.map(s => (
                      <button key={s} className="pill pill-s" onClick={() => setSection(s)}>{s}</button>
                    ))}
                    {sectionsForYear.length === 0 && <div className="empty">No sections listed for this year.</div>}
                  </div>
                </Level>
              )}
            </div>

            {/* ---------- bundles ---------- */}
            {prog && (
              <div className="bundles">
                <div className="tabs">
                  <button className={"tab" + (tab === "main" ? " on" : "")} onClick={() => setTab("main")} disabled={!section}>
                    Main {section && <span className="tab-n">{mainBundle.length}</span>}
                  </button>
                  <button className={"tab" + (tab === "additional" ? " on" : "")} onClick={() => setTab("additional")} disabled={!year}>
                    Additional {year && <span className="tab-n">{additionalBundle.length}</span>}
                  </button>
                  <button className={"tab" + (tab === "electives" ? " on" : "")} onClick={() => setTab("electives")} disabled={!year}>
                    Electives {year && <span className="tab-n">{electiveBundle.length}</span>}
                  </button>
                </div>

                {tab === "main" && !section && <div className="hint">Pick a section above to load its main courses.</div>}
                {tab === "additional" && !year && <div className="hint">Pick a year above — repeat courses are shared across the whole {prog} year, not a single section.</div>}
                {tab === "electives" && !year && <div className="hint">Pick a year above — electives are offered to the whole {prog} year.</div>}
                {tab === "additional" && year && additionalBundle.length === 0 && (
                  <div className="hint">No repeat courses listed for {prog} · {YEAR_LABEL[year]}.</div>
                )}

                {activeList.length > 0 && (
                  <div className="bundle-bar">
                    <span className="bundle-title">
                      {tab === "main" && `${section} · main courses`}
                      {tab === "additional" && `${prog} · ${year ? YEAR_LABEL[year] : ""} repeat courses`}
                      {tab === "electives" && `${prog} · ${year ? YEAR_LABEL[year] : ""} electives`}
                    </span>
                    {allActiveSelected
                      ? <button className="bundle-btn off" onClick={() => removeMany(activeList)}>Remove all</button>
                      : <button className="bundle-btn" onClick={() => addMany(activeList)}>+ Add all</button>}
                  </div>
                )}

                <div className="scroll bundle-scroll">
                  {activeList.map(o => <CourseRow key={o.id} o={o} on={selectedIds.has(o.id)} toggle={toggle} showSec={tab !== "main"} />)}
                  {tab === "electives" && activeList.length === 0 && (
                    <div className="empty">No electives listed for {prog}{year ? " · " + YEAR_LABEL[year] : ""}.</div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </aside>

      {/* ============ RIGHT: TIMETABLE ============ */}
      <main className="stage">
        <div className="stage-bar">
          {/* Once the panel is closed its own toggle goes with it, so the way
              back has to live out here. */}
          {!panel.open && <PanelToggle open={false} onToggle={panel.toggle} />}
          <div className="stage-title">
            <h1>The Lineup</h1>
            <div className="stage-meta">
              <span className="chip-n">{selected.length}</span> course{selected.length !== 1 ? "s" : ""}
              {conflicts > 0 && <span className="clash">⚠ {conflicts} clash{conflicts !== 1 ? "es" : ""}</span>}
            </div>
          </div>
          <div className="stage-actions">
            <button className="ghost" onClick={clearAll} disabled={!selected.length}>Clear</button>
            <button className="primary" onClick={downloadPNG} disabled={!selected.length}>
              <svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Download PNG
            </button>
          </div>
        </div>

        {alsoEnrolled.length > 0 && (
          <div className="enrolled">
            <span className="enrolled-label">Also enrolled · no fixed slot</span>
            <div className="enrolled-chips">
              {alsoEnrolled.map(o => (
                <span key={o.id} className="echip" style={{ background: o.bg, color: o.text }} title={`${o.code ? o.code + " · " : ""}${o.title || o.course}`}>
                  {o.code ? <b>{o.code}</b> : null}{o.course}
                  <span className="echip-sec">{o.section !== "—" ? o.section : o.prog}</span>
                  <button className="echip-x" onClick={() => toggle(o.id)} aria-label="Remove">×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="grid-wrap">
          <div className="grid-scroll">
            <div className="tt" style={{ minWidth: `${92 + periods.length * MIN_BAND_W}px` }}>
              <div className="tt-corner"><span>DAY</span><span className="corner-slash">/</span><span>TIME</span></div>

              <div className="tt-head">
                {periods.map(p => {
                  const [from, to] = p.t.split("-");
                  const left = pct(hhmmToMin(from));
                  return (
                    <span
                      key={p.p}
                      className="tt-head-cell"
                      style={{ left: `${left}%`, width: `${pct(hhmmToMin(to)) - left}%` }}
                    >
                      {p.t}
                    </span>
                  );
                })}
              </div>

              {days.map(d => {
                const row = week.byDay[d];
                return (
                  <React.Fragment key={d}>
                    <div className="tt-day">{d}</div>
                    <div className="tt-row" style={{ height: `${row.lanes * LANE_H + 12}px` }}>
                      {/* Band boundaries, drawn from the same axis as the blocks
                          so the columns and the classes always line up. */}
                      {periods.slice(1).map(p => (
                        <span key={p.p} className="tt-divider" style={{ left: `${pct(bandBounds[p.p][0])}%` }} />
                      ))}

                      {row.items.map((it, i) => {
                        const left = pct(it.start);
                        const when = it.meeting.end
                          ? `${it.meeting.start}–${it.meeting.end}`
                          : it.meeting.time;
                        return (
                          <div
                            key={it.o.id + "-" + i}
                            className={"tt-block" + (it.clash ? " tt-block-clash" : "")}
                            style={{
                              left: `calc(${left}% + 3px)`,
                              width: `calc(${pct(it.end) - left}% - 6px)`,
                              top: `${6 + it.lane * LANE_H}px`,
                              background: it.o.bg,
                              color: it.o.text,
                            }}
                            tabIndex={0}
                            {...bind(<BlockTip it={it} when={when} />)}
                          >
                            <span className="block-spine" style={{ background: it.o.text }} />
                            {it.o.code ? <div className="block-eyebrow">{it.o.code}</div> : null}
                            <div className="block-code">{it.o.course}</div>
                            <div className="block-meta">
                              <span className="block-sec">{it.o.section}</span>
                              <span className="block-room">{it.room}</span>
                            </div>
                            {/* The time is pinned and the name ellipsizes, not the
                                other way round: the instructor column sometimes
                                holds a note rather than a name ("merged with
                                Applied Prob BDS-7A"), which no sensible column
                                width would ever fit. */}
                            <div className="block-inst">
                              <span className="block-inst-name">{it.o.instructor}</span>
                              <span className="block-inst-time">{when}</span>
                            </div>
                            <button className="block-x" onClick={() => toggle(it.o.id)} aria-label="Remove">×</button>
                          </div>
                        );
                      })}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
          {selected.length === 0 && (
            <div className="stage-empty">
              <div className="stage-empty-glyph">◱</div>
              <p>Your week is empty.</p>
              <span>Choose a program, year and section on the left — then add a bundle or single courses. They drop straight into the grid.</span>
            </div>
          )}
        </div>
      </main>

      {tooltip}

      {pngPreview && (
        <div className="modal" onClick={() => setPngPreview(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <span>Timetable image</span>
              <button className="modal-x" onClick={() => setPngPreview(null)} aria-label="Close">×</button>
            </div>
            <div className="modal-body"><img src={pngPreview} alt="Your timetable" className="modal-img" /></div>
            <div className="modal-foot">
              <a className="primary" href={pngPreview} download={exportFilename}>Save image</a>
              <span className="modal-hint">If the download didn't start, right-click (or long-press on mobile) the image to save it.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Level({ label, children }) {
  return (<div className="level"><div className="level-label">{label}</div>{children}</div>);
}

function CourseRow({ o, on, toggle, showSec }) {
  return (
    <button className={"crow" + (on ? " on" : "")} onClick={() => toggle(o.id)} style={on ? { borderColor: o.text } : undefined}>
      <span className="crow-swatch" style={{ background: o.bg, color: o.text }}>{o.course.slice(0, 2).toUpperCase()}</span>
      <span className="crow-main">
        <span className="crow-name">{o.course}</span>
        <span className="crow-sub">{showSec ? o.section + " · " : ""}{o.instructor} · {o.meetings.length ? `${o.meetings.length} slot${o.meetings.length !== 1 ? "s" : ""}` : "no fixed slot"}</span>
      </span>
      <span className={"crow-tick" + (on ? " on" : "")}>{on ? "✓" : "+"}</span>
    </button>
  );
}

const BUCKET_LABEL = { main: "Core", repeat: "Repeat", elective: "Elective" };

/**
 * What a block shows on hover. The block itself only has room for a short name
 * and a room number, so this is where the full title, the exact times and the
 * course's other weekly meeting live.
 */
function BlockTip({ it, when }) {
  const o = it.o;
  const others = o.meetings.filter(m => m !== it.meeting);
  return (
    <>
      <TipHead code={o.code} title={o.title || o.course} />
      <TipRow label="Section">{o.section}</TipRow>
      <TipRow label="Teacher">{o.instructorFull || o.instructor}</TipRow>
      <TipRow label="Room"><b>{it.room}</b></TipRow>
      <TipRow label="Time">
        <b>{it.meeting.day} {when}</b>
        {it.meeting.duration ? ` · ${it.meeting.duration} min` : ""}
      </TipRow>
      <TipRow label="Type">
        {BUCKET_LABEL[o.bucket] || o.bucket} · {o.prog} Year {o.year}
      </TipRow>
      {others.length > 0 && (
        <TipRow label="Also">
          {others.map((m, i) => (
            <span key={i}>
              {i > 0 && ", "}
              <b>{m.day} {m.end ? `${m.start}\u2013${m.end}` : m.time}</b>
              {m.room !== it.room ? ` · ${m.room}` : ""}
            </span>
          ))}
        </TipRow>
      )}
      {it.clash && (
        <TipNote tone="warn">
          Overlaps another course you&rsquo;ve added at this time.
        </TipNote>
      )}
    </>
  );
}
