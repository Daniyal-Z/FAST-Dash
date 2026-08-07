import { useCallback, useEffect, useState } from 'react'
import { isConfigured } from '../lib/supabase.js'
import { loadDataset, readCache } from '../lib/datasets.js'

/**
 * Loads a published dataset for one kind and school.
 *
 * The cached copy is shown immediately so a returning visitor sees their
 * timetable without waiting for the network, then the hook revalidates and
 * swaps in newer data if the admin has published since.
 *
 * Pass a null school to stay idle — the school pickers use this while the
 * visitor has not chosen yet, so nothing is downloaded prematurely.
 *
 * status: 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'unconfigured'
 */
export function useDataset(kind, school) {
  const [row, setRow] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!isConfigured) {
      setStatus('unconfigured')
      return
    }
    if (!school) {
      setRow(null)
      setStatus('idle')
      return
    }

    // Paint from cache straight away, then revalidate.
    const cached = readCache(kind, school)
    setRow(cached)
    setStatus(cached ? 'ready' : 'loading')

    let cancelled = false
    ;(async () => {
      try {
        const next = await loadDataset(kind, school)
        if (cancelled) return
        if (next) {
          setRow(next)
          setStatus('ready')
        } else {
          setRow(null)
          setStatus('empty')
        }
        setError(null)
      } catch (err) {
        if (cancelled) return
        // A stale cached copy beats an error screen.
        setError(err)
        setStatus(cached ? 'ready' : 'error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [kind, school, nonce])

  return {
    data: row?.payload ?? null,
    label: row?.label ?? null,
    updatedAt: row?.updated_at ?? null,
    status,
    error,
    refresh,
  }
}

/**
 * Metadata for everything published, without any payloads.
 *
 * The school pickers need to know which schools have a timetable before
 * downloading one, and this listing is about a kilobyte, so it is cheap to ask
 * for on every page load.
 *
 * status: 'loading' | 'ready' | 'error' | 'unconfigured'
 */
export function useAllMeta() {
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState(isConfigured ? 'loading' : 'unconfigured')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isConfigured) return
    let cancelled = false
    ;(async () => {
      try {
        const { fetchAllMeta } = await import('../lib/datasets.js')
        const data = await fetchAllMeta()
        if (cancelled) return
        setRows(data)
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(err)
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { rows, status, error }
}
