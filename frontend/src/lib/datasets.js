import { supabase, isConfigured } from './supabase.js'

export const KINDS = { timetable: 'timetable', datesheet: 'datesheet' }

const cacheKey = (kind) => `fastdash:dataset:${kind}`

/** Read the locally cached copy of a dataset, if any. */
export function readCache(kind) {
  try {
    const raw = localStorage.getItem(cacheKey(kind))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.payload || !parsed?.updated_at) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(kind, row) {
  try {
    localStorage.setItem(cacheKey(kind), JSON.stringify(row))
  } catch {
    // Storage full or blocked (private mode). The app still works, just uncached.
  }
}

/**
 * Fetch just the metadata. This is a tiny response, so it can be requested on
 * every page load to decide whether the cached payload is still current.
 */
export async function fetchMeta(kind) {
  const { data, error } = await supabase
    .from('datasets')
    .select('kind, label, updated_at, source_filename')
    .eq('kind', kind)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function fetchFull(kind) {
  const { data, error } = await supabase
    .from('datasets')
    .select('kind, label, updated_at, source_filename, payload')
    .eq('kind', kind)
    .maybeSingle()
  if (error) throw error
  return data
}

/** Metadata for every dataset at once — used by the landing page. */
export async function fetchAllMeta() {
  if (!isConfigured) return []
  const { data, error } = await supabase
    .from('datasets')
    .select('kind, label, updated_at')
  if (error) throw error
  return data ?? []
}

/**
 * Load a dataset, preferring the cached payload when the server says it has not
 * changed. Returns the row, or null when nothing has been published yet.
 */
export async function loadDataset(kind) {
  const cached = readCache(kind)
  const meta = await fetchMeta(kind)

  if (!meta) return null
  if (cached && cached.updated_at === meta.updated_at) {
    return { ...cached, ...meta }
  }

  const full = await fetchFull(kind)
  if (full) writeCache(kind, full)
  return full
}

/** Publish a parsed dataset. Requires an authenticated admin (enforced by RLS). */
export async function publishDataset({ kind, label, payload, sourceFilename, userId }) {
  const { error } = await supabase.from('datasets').upsert(
    {
      kind,
      label,
      payload,
      source_filename: sourceFilename ?? null,
      updated_at: new Date().toISOString(),
      updated_by: userId ?? null,
    },
    { onConflict: 'kind' },
  )
  if (error) throw error
  // Drop the local copy so this browser re-fetches what it just published.
  try {
    localStorage.removeItem(cacheKey(kind))
  } catch {
    /* ignore */
  }
}
