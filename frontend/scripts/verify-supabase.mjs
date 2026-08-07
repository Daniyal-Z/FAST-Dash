/**
 * Checks that a Supabase project is set up the way the app expects.
 *
 * Run after applying supabase/schema.sql:
 *   npm run verify:supabase
 *
 * Uses only the anon key — exactly what a student's browser has — so it also
 * proves that an anonymous visitor can read the data but cannot change it.
 * Nothing here writes anything on a correctly configured project.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

/* ------------------------------------------------------------ env loading */

function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(root, name)
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (!m) continue
      const value = m[2].replace(/^["']|["']$/g, '')
      if (!process.env[m[1]]) process.env[m[1]] = value
    }
  }
}
loadEnv()

const url = process.env.VITE_SUPABASE_URL
const anon = process.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon || url.includes('your-project-ref') || anon.includes('your_key_here')) {
  console.log(
    '\n\x1b[31mNo credentials.\x1b[0m Copy frontend/.env.example to ' +
      'frontend/.env.local and fill in your project URL and key.\n' +
      '\nThe quickest source for both is the "Connect" button at the top of\n' +
      'the Supabase dashboard.\n',
  )
  process.exit(1)
}

// A secret key here would be compiled into the browser bundle and would bypass
// RLS for anyone who opened devtools. Refuse rather than test against it.
const isSecret =
  anon.startsWith('sb_secret_') ||
  (anon.startsWith('eyJ') && safeRole(anon) === 'service_role')

if (isSecret) {
  console.log(
    '\n\x1b[31m\x1b[1mSTOP — that is a secret key.\x1b[0m\n\n' +
      'VITE_SUPABASE_ANON_KEY holds a service_role / secret key. Anything in a\n' +
      'VITE_ variable is compiled into the JavaScript bundle and served to every\n' +
      'visitor, and this key bypasses Row Level Security completely.\n\n' +
      'Replace it with the publishable key (sb_publishable_...) or the legacy\n' +
      'anon key, and rotate the exposed one in Settings -> API Keys.\n',
  )
  process.exit(1)
}

/** Read the `role` claim from a JWT without verifying it. */
function safeRole(jwt) {
  try {
    const payload = jwt.split('.')[1]
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).role
  } catch {
    return null
  }
}

const db = createClient(url, anon, { auth: { persistSession: false } })

let failed = 0
const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const fail = (m, fix) => {
  failed++
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  if (fix) console.log(`    \x1b[2m→ ${fix}\x1b[0m`)
}
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`)

console.log(`\n\x1b[1mChecking ${url}\x1b[0m\n`)

/* ------------------------------------------------------------ 1. schema -- */

console.log('\x1b[1mTables\x1b[0m')
for (const table of ['datasets', 'admins', 'upload_log']) {
  const { error } = await db.from(table).select('*', { count: 'exact', head: true })
  // A permission error still proves the table exists; only "does not exist" is fatal.
  if (error && /does not exist|schema cache/i.test(error.message)) {
    fail(`public.${table} is missing`, 'Run supabase/schema.sql in the SQL editor.')
  } else {
    pass(`public.${table} exists`)
  }
}

// RLS hides rows rather than erroring, so selecting a column we cannot read
// still tells us whether that column exists — a missing one is a 400.
const colProbe = await db.from('upload_log').select('action').limit(1)
if (colProbe.error && /column .* does not exist|action/i.test(colProbe.error.message)) {
  fail(
    'upload_log.action is missing — the unpublish support has not been applied',
    'Re-run supabase/schema.sql; it is idempotent and adds the column plus the ' +
      'DELETE policy that lets an admin take a sheet down.',
  )
} else {
  pass('upload_log.action exists (unpublish supported)')
}

/* --------------------------------------------------------- 2. public read */

console.log('\n\x1b[1mAnonymous read access\x1b[0m')
const { data: rows, error: readErr } = await db
  .from('datasets')
  .select('kind, label, updated_at')

if (readErr) {
  fail(`Cannot read datasets: ${readErr.message}`, 'Check the "datasets are public" SELECT policy.')
} else {
  pass(`Readable by anonymous visitors (${rows.length} published)`)
  for (const r of rows) console.log(`      \x1b[2m${r.kind.padEnd(10)} ${r.label}\x1b[0m`)
  if (rows.length === 0) warn('Nothing published yet — upload both sheets from /admin.')
  else {
    for (const kind of ['timetable', 'datesheet']) {
      if (!rows.some((r) => r.kind === kind)) warn(`No ${kind} published yet.`)
    }
  }
}

/* ------------------------------------------------------- 3. writes denied */

console.log('\n\x1b[1mRow Level Security\x1b[0m')

// upload_log is used as the probe: it is an append-only audit table, so even in
// the failure case the worst outcome is one stray row that is easy to delete.
const probe = await db
  .from('upload_log')
  .insert({ kind: 'rls-probe', label: 'verify:supabase probe' })
  .select()

if (probe.error) {
  const denied = probe.error.code === '42501' || /row-level security|permission/i.test(probe.error.message)
  denied
    ? pass('Anonymous writes are rejected')
    : fail(`Unexpected error probing writes: ${probe.error.message}`)
} else {
  fail(
    'An anonymous client was able to INSERT — RLS is NOT protecting your data.',
    'Re-run supabase/schema.sql; then delete the row labelled "verify:supabase probe".',
  )
}

const upd = await db.from('datasets').update({ label: 'rls-probe' }).eq('kind', 'timetable').select()
if (upd.error || (upd.data && upd.data.length === 0)) {
  pass('Anonymous updates to datasets are rejected')
} else {
  fail('An anonymous client MODIFIED a dataset — RLS is NOT protecting your data.')
}

/* ------------------------------------------------------------ 4. storage */

console.log('\n\x1b[1mStorage\x1b[0m')
const up = await db.storage.from('source-workbooks').upload('probe.txt', new Blob(['probe']))
if (up.error) {
  /Bucket not found/i.test(up.error.message)
    ? fail('Bucket "source-workbooks" is missing', 'Re-run the storage section of schema.sql.')
    : pass('Bucket exists and rejects anonymous uploads')
} else {
  fail('An anonymous client uploaded to storage — check the storage policies.')
}

/* ---------------------------------------------------------- 5. signup off */

console.log('\n\x1b[1mAuth\x1b[0m')
const probeEmail = `signup-probe-${Math.random().toString(36).slice(2)}@example.com`
const signUp = await db.auth.signUp({ password: crypto.randomUUID(), email: probeEmail })
if (signUp.error) {
  /disabled|not allowed/i.test(signUp.error.message)
    ? pass('Public signup is disabled')
    : warn(`Signup returned: ${signUp.error.message}`)
} else {
  fail(
    'Public signup is ENABLED — anyone can create an account.',
    'Authentication → Providers → Email → turn off "Allow new users to sign up". ' +
      `Then delete the user ${probeEmail}.`,
  )
}

console.log(
  failed === 0
    ? '\n\x1b[32m\x1b[1mSupabase looks correctly configured.\x1b[0m\n'
    : `\n\x1b[31m\x1b[1m${failed} problem(s) to fix.\x1b[0m\n`,
)
process.exit(failed === 0 ? 0 : 1)
