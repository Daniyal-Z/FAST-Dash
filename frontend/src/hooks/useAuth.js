import { useEffect, useState } from 'react'
import { supabase, isConfigured } from '../lib/supabase.js'

/**
 * Tracks the Supabase session and whether that user is an administrator.
 *
 * Being in the `admins` table is what grants write access; this hook only
 * mirrors that for the UI. The database enforces it independently through RLS,
 * so a tampered client gains nothing.
 *
 * status: 'loading' | 'signed-out' | 'admin' | 'not-admin' | 'unconfigured'
 */
export function useAuth() {
  const [session, setSession] = useState(null)
  const [status, setStatus] = useState(isConfigured ? 'loading' : 'unconfigured')

  useEffect(() => {
    if (!isConfigured) return
    let cancelled = false

    const resolve = async (s) => {
      if (cancelled) return
      setSession(s)
      if (!s) {
        setStatus('signed-out')
        return
      }
      const { data, error } = await supabase
        .from('admins')
        .select('user_id')
        .eq('user_id', s.user.id)
        .maybeSingle()
      if (cancelled) return
      setStatus(!error && data ? 'admin' : 'not-admin')
    }

    supabase.auth.getSession().then(({ data }) => resolve(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => resolve(s))

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return {
    session,
    user: session?.user ?? null,
    status,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signOut: () => supabase.auth.signOut(),
    resetPassword: (email) =>
      supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/admin`,
      }),
  }
}
