import { supabase, isConfigured } from './supabase.js'
import { ALL_SCHOOLS } from './schools.js'

export const KINDS = { timetable: 'timetable', datesheet: 'datesheet' }

/**
 * A dataset is identified by kind *and* school. Timetables are published per
 * school; the exam datesheet is university-wide and always uses ALL.
 */
const cacheKey = (kind, school) => `fastdash:dataset:${kind}:${school}`

/** Read the locally cached copy of a dataset, if any. */
export function readCache(kind, school) {
  try {
    const raw = localStorage.getItem(cacheKey(kind, school))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.payload || !parsed?.updated_at) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(kind, school, row) {
  try {
    localStorage.setItem(cacheKey(kind, school), JSON.stringify(row))
  } catch {
    // Storage full or blocked (private mode). The app still works, just uncached.
  }
}

function clearCache(kind, school) {
  try {
    localStorage.removeItem(cacheKey(kind, school))
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

const SELECT_META = 'kind, school, label, updated_at, source_filename'

/**
 * Fetch just the metadata. This is a tiny response, so it can be requested on
 * every page load to decide whether the cached payload is still current.
 */
export async function fetchMeta(kind, school) {
  const { data, error } = await supabase
    .from('datasets')
    .select(SELECT_META)
    .eq('kind', kind)
    .eq('school', school)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function fetchFull(kind, school) {
  const { data, error } = await supabase
    .from('datasets')
    .select(`${SELECT_META}, payload`)
    .eq('kind', kind)
    .eq('school', school)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Metadata for every published dataset — used by the landing page and by the
 * school pickers, which need to know which schools have a timetable before
 * downloading any of them.
 */
export async function fetchAllMeta() {
  if (!isConfigured) return []
  const { data, error } = await supabase
    .from('datasets')
    .select('kind, school, label, updated_at')
  if (error) throw error
  return data ?? []
}

/**
 * Load a dataset, preferring the cached payload when the server says it has not
 * changed. Returns the row, or null when nothing has been published yet.
 */
export async function loadDataset(kind, school) {
  const cached = readCache(kind, school)
  const meta = await fetchMeta(kind, school)

  if (!meta) {
    // Unpublished since this browser last looked — drop the local copy so it
    // cannot resurface on the next visit.
    clearCache(kind, school)
    return null
  }
  if (cached && cached.updated_at === meta.updated_at) {
    return { ...cached, ...meta }
  }

  const full = await fetchFull(kind, school)
  if (full) writeCache(kind, school, full)
  return full
}

/** Publish a parsed dataset. Requires an authenticated admin (enforced by RLS). */
export async function publishDataset({ kind, school, label, payload, sourceFilename, userId }) {
  const { error } = await supabase.from('datasets').upsert(
    {
      kind,
      school: school ?? ALL_SCHOOLS,
      label,
      payload,
      source_filename: sourceFilename ?? null,
      updated_at: new Date().toISOString(),
      updated_by: userId ?? null,
    },
    { onConflict: 'kind,school' },
  )
  if (error) throw error
  // Drop the local copy so this browser re-fetches what it just published.
  clearCache(kind, school ?? ALL_SCHOOLS)
}

/**
 * Take a dataset down. The page it powers returns to its "nothing published
 * yet" state; the archived source workbook in Storage is deliberately kept.
 * Requires an authenticated admin (enforced by RLS).
 */
export async function unpublishDataset(kind, school) {
  const { error } = await supabase
    .from('datasets')
    .delete()
    .eq('kind', kind)
    .eq('school', school)
  if (error) throw error
  clearCache(kind, school)
}
