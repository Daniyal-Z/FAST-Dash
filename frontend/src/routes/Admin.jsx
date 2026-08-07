import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import { fetchAllMeta, publishDataset, unpublishDataset } from '../lib/datasets.js'
import { archiveSource, inviteAdmin, listAdmins, listUploads, logUpload, revokeAdmin } from '../lib/admin.js'
import { NotConfiguredScreen, Screen } from '../components/States.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { relativeTime } from '../lib/format.js'

export default function Admin() {
  const auth = useAuth()

  if (auth.status === 'unconfigured') return <NotConfiguredScreen />
  if (auth.status === 'loading') {
    return <Screen glyph={<span className="fd-spin inline-block">◱</span>} title="Checking your session…" />
  }
  if (auth.status === 'signed-out') return <SignIn auth={auth} />
  if (auth.status === 'not-admin') {
    return (
      <Screen
        glyph="⛔"
        title="Not an administrator"
        action={<button className="ghost" onClick={auth.signOut}>Sign out</button>}
      >
        You’re signed in as <strong style={{ color: 'var(--tx)' }}>{auth.user?.email}</strong>, but
        that account hasn’t been granted admin access. Ask an existing administrator to invite you.
      </Screen>
    )
  }
  return <AdminHome auth={auth} />
}

/* --------------------------------------------------------------- sign in */

function SignIn({ auth }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await auth.signIn(email.trim(), password)
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="fd-paper grid place-items-center px-6" style={{ minHeight: 'calc(100dvh - var(--nav-h))' }}>
      <form onSubmit={submit} className="fd-card w-full max-w-sm" style={{ animation: 'drop .35s ease' }}>
        <div className="mb-1 flex items-center gap-3">
          <span className="fd-mark">FD</span>
          <div>
            <h1 className="m-0 text-[17px] font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
              Administrator sign in
            </h1>
            <p className="m-0 text-[11.5px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--tx-3)' }}>
              Publishing access only
            </p>
          </div>
        </div>

        <div className="mt-5">
          <label className="fd-label" htmlFor="email">Email</label>
          <input id="email" className="fd-input" type="email" autoComplete="username"
            value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="mt-3.5">
          <label className="fd-label" htmlFor="password">Password</label>
          <input id="password" className="fd-input" type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>

        {error && <div className="fd-note fd-note-warn mt-4">{error}</div>}

        <button type="submit" className="primary mt-5 w-full justify-center" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {/* Deliberately no self-service reset: it is an unauthenticated endpoint
            that will mail any address it is handed. Resets are done from the
            Supabase dashboard instead. */}
        <p className="mt-4 mb-0 text-center text-[11.5px] leading-relaxed" style={{ color: 'var(--tx-3)' }}>
          Locked out? Ask another administrator to reset your password from the
          Supabase dashboard.
        </p>
      </form>
    </div>
  )
}

/* ------------------------------------------------------------------- home */

const TABS = [
  { id: 'publish', label: 'Publish' },
  { id: 'admins', label: 'Administrators' },
  { id: 'activity', label: 'Activity' },
]

function AdminHome({ auth }) {
  const [tab, setTab] = useState('publish')
  const [reloadKey, setReloadKey] = useState(0)
  const [live, setLive] = useState({})

  const reload = useCallback(() => {
    setReloadKey((n) => n + 1)
    fetchAllMeta()
      .then((rows) => setLive(Object.fromEntries(rows.map((r) => [r.kind, r]))))
      .catch(() => {})
  }, [])
  useEffect(reload, [reload])

  return (
    <div className="fd-paper" style={{ minHeight: 'calc(100dvh - var(--nav-h))' }}>
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="m-0 text-[26px] font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
              Admin
            </h1>
            <p className="m-0 mt-1 text-[12px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--tx-3)' }}>
              {auth.user?.email}
            </p>
          </div>
          <button className="ghost" onClick={auth.signOut}>Sign out</button>
        </header>

        <div className="tabs mb-6">
          {TABS.map((t) => (
            <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'publish' && (
          <div className="flex flex-col gap-5">
            <UploadCard
              kind="timetable"
              title="Class timetable"
              hint="The FSC timetable workbook — the one with the CS / SE / DS / AI / CY / CI sheets."
              userId={auth.user?.id}
              userEmail={auth.user?.email}
              live={live.timetable}
              onChanged={reload}
            />
            <UploadCard
              kind="datesheet"
              title="Exam datesheet"
              hint="The exam workbook with the “Complete” sheet."
              userId={auth.user?.id}
              userEmail={auth.user?.email}
              live={live.datesheet}
              onChanged={reload}
            />
          </div>
        )}
        {tab === 'admins' && <AdminsTab currentUserId={auth.user?.id} />}
        {tab === 'activity' && <ActivityTab reloadKey={reloadKey} />}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- upload + publish */

const PARSERS = {
  timetable: async () => (await import('../lib/parsers/timetable.js')).parseTimetable,
  datesheet: async () => (await import('../lib/parsers/datesheet.js')).parseDatesheet,
}

function UploadCard({ kind, title, hint, userId, userEmail, live, onChanged }) {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const [label, setLabel] = useState('')
  const [phase, setPhase] = useState('idle') // idle | parsing | parsed | publishing | done
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const reset = () => {
    setFile(null); setResult(null); setLabel(''); setPhase('idle'); setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleFile = async (f) => {
    if (!f) return
    setFile(f); setError(null); setResult(null); setPhase('parsing')
    try {
      const [{ read }, parse] = await Promise.all([import('xlsx'), PARSERS[kind]()])
      const buffer = await f.arrayBuffer()
      const workbook = read(buffer, { type: 'array' })
      const parsed = parse(workbook)
      setResult(parsed)
      setLabel(parsed.label)
      setPhase('parsed')
    } catch (err) {
      setError(err.message || String(err))
      setPhase('idle')
    }
  }

  const publish = async () => {
    if (!result) return
    setPhase('publishing'); setError(null)
    try {
      await publishDataset({
        kind,
        label: label.trim() || result.label,
        payload: result.data,
        sourceFilename: file?.name,
        userId,
      })
      // Best-effort extras: neither should undo a successful publish.
      try { await archiveSource(kind, file) } catch (e) { console.warn('Could not archive source file:', e) }
      try {
        await logUpload({
          kind, label: label.trim() || result.label, filename: file?.name,
          stats: { ...result.stats, warnings: result.warnings.length }, userId, userEmail,
        })
      } catch (e) { console.warn('Could not write the activity log:', e) }
      setPhase('done')
      onChanged?.()
    } catch (err) {
      setError(err.message || String(err))
      setPhase('parsed')
    }
  }

  const onDrop = (e) => {
    e.preventDefault(); setDragging(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  const remove = async () => {
    setRemoving(true); setError(null)
    try {
      await unpublishDataset(kind)
      try {
        await logUpload({ kind, action: 'unpublish', label: live.label, userId, userEmail })
      } catch (e) { console.warn('Could not write the activity log:', e) }
      reset()
      setConfirming(false)
      onChanged?.()
    } catch (err) {
      setError(err.message || String(err))
      setConfirming(false)
    }
    setRemoving(false)
  }

  return (
    <section className="fd-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-[16px] font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
          {title}
        </h2>
        {phase !== 'idle' && (
          <button className="cursor-pointer border-0 bg-transparent text-[12px]"
            style={{ color: 'var(--tx-3)' }} onClick={reset}>
            Start over
          </button>
        )}
      </div>
      <p className="mt-1.5 mb-4 text-[12.5px] leading-relaxed" style={{ color: 'var(--tx-2)' }}>{hint}</p>

      {live ? (
        <div className="fd-live mb-4">
          <span className="fd-live-dot" />
          <span className="fd-live-main">
            <span className="fd-live-label">{live.label}</span>
            <span className="fd-live-meta">live · updated {relativeTime(live.updated_at)}</span>
          </span>
          <button className="fd-live-remove" onClick={() => setConfirming(true)} disabled={removing}>
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      ) : (
        <div className="fd-live fd-live-empty mb-4">
          <span className="fd-live-main">
            <span className="fd-live-meta">Nothing published — this page is empty for students.</span>
          </span>
        </div>
      )}

      {phase === 'done' ? (
        <div className="fd-note fd-note-ok">
          <strong>Published.</strong> “{label}” is live now — visitors will see it on their next
          page load. No rebuild or redeploy needed.
        </div>
      ) : (
        <>
          <label
            className={'fd-drop' + (dragging ? ' on' : '')}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <span className="fd-drop-glyph">⬆</span>
            <span className="fd-drop-main">
              {file ? file.name : 'Drop the .xlsx here, or click to choose'}
            </span>
            <span className="fd-drop-sub">
              {phase === 'parsing' ? 'Reading the workbook…' : 'Nothing is published until you confirm.'}
            </span>
          </label>

          {error && <div className="fd-note fd-note-warn mt-4">{error}</div>}

          {phase === 'parsed' || phase === 'publishing' ? (
            <Report
              result={result}
              label={label}
              setLabel={setLabel}
              busy={phase === 'publishing'}
              onPublish={publish}
            />
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={confirming}
        destructive
        busy={removing}
        title={`Take this ${kind} down?`}
        confirmLabel="Remove it"
        cancelLabel="Keep it"
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      >
        <strong>{live?.label}</strong> will stop being shown. The {kind} page goes back to
        “nothing published”, and anyone who already had it loaded will see it disappear on their
        next visit.
        <br />
        <br />
        You can publish again at any time, and the uploaded file stays in the archive.
      </ConfirmDialog>
    </section>
  )
}

function Report({ result, label, setLabel, busy, onPublish }) {
  const { stats, warnings } = result
  const entries = Object.entries(stats).filter(([, v]) => typeof v === 'number')
  const groups = Object.entries(stats).filter(([, v]) => v && typeof v === 'object')

  return (
    <div className="mt-5" style={{ animation: 'drop .3s ease' }}>
      <div className="fd-statgrid">
        {entries.map(([k, v]) => (
          <div key={k} className="fd-stat">
            <span className="fd-stat-n">{v.toLocaleString()}</span>
            <span className="fd-stat-k">{k}</span>
          </div>
        ))}
      </div>

      {groups.map(([name, obj]) => (
        <div key={name} className="mt-3.5">
          <span className="fd-label">{name}</span>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(obj).map(([k, v]) => (
              <span key={k} className="fd-pillstat"><b>{k}</b>{v}</span>
            ))}
          </div>
        </div>
      ))}

      <div className="mt-5">
        <label className="fd-label" htmlFor={'label-' + label}>Published label</label>
        <input
          id={'label-' + label}
          className="fd-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Fall 2026 · Midterm I"
        />
        <p className="mt-2 text-[11.5px] leading-relaxed" style={{ color: 'var(--tx-3)' }}>
          Read from the workbook’s heading. The source files are not always consistent about this,
          so check it before publishing.
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="fd-note fd-note-warn mt-4">
          <strong>{warnings.length} thing{warnings.length === 1 ? '' : 's'} to look at</strong>
          <ul className="mt-2 mb-0 list-disc pl-5">
            {warnings.map((w, i) => <li key={i} className="mt-1">{w}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button className="primary" onClick={onPublish} disabled={busy}>
          {busy ? 'Publishing…' : 'Publish — replace the live version'}
        </button>
        <span className="text-[12px]" style={{ color: 'var(--tx-3)' }}>
          This replaces what everyone currently sees.
        </span>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- admins */

function AdminsTab({ currentUserId }) {
  const [rows, setRows] = useState(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [pendingRevoke, setPendingRevoke] = useState(null)

  const load = useCallback(() => {
    listAdmins().then(setRows).catch((e) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const invite = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    try {
      await inviteAdmin(email.trim())
      setNotice(`Invitation sent to ${email.trim()}. They’ll get an email to set a password.`)
      setEmail('')
      load()
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  const revoke = async () => {
    const row = pendingRevoke
    setBusy(true); setError(null); setNotice(null)
    try {
      await revokeAdmin(row.user_id)
      setNotice(`${row.email} no longer has admin access.`)
      load()
    } catch (err) {
      setError(err.message)
    }
    setPendingRevoke(null)
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="fd-card">
        <h2 className="m-0 text-[16px] font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
          Invite an administrator
        </h2>
        <p className="mt-1.5 mb-4 text-[12.5px]" style={{ color: 'var(--tx-2)' }}>
          They’ll receive an email to set their own password. Only invited accounts can sign in.
        </p>
        <form onSubmit={invite} className="flex flex-wrap gap-2.5">
          <input className="fd-input flex-1" style={{ minWidth: '220px' }} type="email" required
            placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="primary" disabled={busy}>{busy ? 'Working…' : 'Send invite'}</button>
        </form>
        {error && <div className="fd-note fd-note-warn mt-4">{error}</div>}
        {notice && <div className="fd-note fd-note-ok mt-4">{notice}</div>}
      </section>

      <section className="fd-card">
        <span className="fd-label">Current administrators</span>
        {rows === null ? (
          <p className="text-[13px]" style={{ color: 'var(--tx-3)' }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--tx-3)' }}>Nobody yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((r) => (
              <li key={r.user_id} className="fd-row">
                <span className="flex-1 text-[13.5px]">{r.email}</span>
                <span className="text-[11.5px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--tx-3)' }}>
                  added {relativeTime(r.added_at)}
                </span>
                {r.user_id === currentUserId ? (
                  <span className="fd-pillstat">you</span>
                ) : (
                  <button className="ds-x" title="Revoke access" onClick={() => setPendingRevoke(r)} disabled={busy}>×</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(pendingRevoke)}
        destructive
        busy={busy}
        title="Revoke admin access?"
        confirmLabel="Revoke access"
        cancelLabel="Cancel"
        onCancel={() => setPendingRevoke(null)}
        onConfirm={revoke}
      >
        <strong>{pendingRevoke?.email}</strong> will no longer be able to publish or manage
        administrators.
        <br />
        <br />
        Their sign-in is left intact and their entries stay in the activity log — only the admin
        permission is removed.
      </ConfirmDialog>
    </div>
  )
}

/* -------------------------------------------------------------- activity */

function ActivityTab({ reloadKey }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    listUploads().then(setRows).catch((e) => setError(e.message))
  }, [reloadKey])

  return (
    <section className="fd-card">
      <span className="fd-label">Publishing history</span>
      {error && <div className="fd-note fd-note-warn">{error}</div>}
      {rows === null ? (
        <p className="text-[13px]" style={{ color: 'var(--tx-3)' }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--tx-3)' }}>Nothing has been published yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((r) => (
            <li key={r.id} className="fd-row">
              <span className="fd-pillstat"><b>{r.kind}</b></span>
              {r.action === 'unpublish' && (
                <span className="fd-pillstat" style={{ color: 'var(--clash)', borderColor: 'rgba(255,107,129,.4)' }}>
                  removed
                </span>
              )}
              <span
                className="flex-1 text-[13.5px]"
                style={r.action === 'unpublish' ? { color: 'var(--tx-3)', textDecoration: 'line-through' } : undefined}
              >
                {r.label}
              </span>
              <span className="text-[11.5px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--tx-3)' }}>
                {r.created_by_email || 'unknown'} · {relativeTime(r.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
