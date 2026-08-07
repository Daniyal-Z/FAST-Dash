import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * True when the app has been given Supabase credentials.
 * When false we still render — pages show a "not configured" empty state
 * instead of crashing — so the UI can be developed without a project.
 */
export const isConfigured = Boolean(url && anonKey)

export const supabase = isConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Students never sign in; only /admin does. Detecting the session in
        // the URL is needed for the invite / password-recovery email links.
        detectSessionInUrl: true,
      },
    })
  : null

/** Storage bucket holding the raw uploaded workbooks, for re-parsing later. */
export const SOURCE_BUCKET = 'source-workbooks'
