import { useCallback, useEffect, useState } from 'react'
import { isConfigured } from '../lib/supabase.js'
import { loadDataset, readCache } from '../lib/datasets.js'

/**
 * Loads a published dataset.
 *
 * The cached copy is shown immediately so a returning visitor sees their
 * timetable without waiting for the network, then the hook revalidates and
 * swaps in newer data if the admin has published since.
 *
 * status: 'loading' | 'ready' | 'empty' | 'error' | 'unconfigured'
 */
export function useDataset(kind) {
  const cached = isConfigured ? readCache(kind) : null

  const [row, setRow] = useState(cached)
  const [status, setStatus] = useState(() => {
    if (!isConfigured) return 'unconfigured'
    return cached ? 'ready' : 'loading'
  })
  const [error, setError] = useState(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!isConfigured) return
    let cancelled = false

    ;(async () => {
      try {
        const next = await loadDataset(kind)
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
        setStatus((prev) => (prev === 'ready' ? 'ready' : 'error'))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [kind, nonce])

  return {
    data: row?.payload ?? null,
    label: row?.label ?? null,
    updatedAt: row?.updated_at ?? null,
    status,
    error,
    refresh,
  }
}
