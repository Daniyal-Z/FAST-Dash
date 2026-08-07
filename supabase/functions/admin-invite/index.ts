/**
 * admin-invite — the only server-side code in FAST-Dash.
 *
 * Creating and deleting auth users requires the service-role key, which must
 * never be shipped to a browser. This function holds it, and re-checks that
 * the caller is a genuine administrator before doing anything with it.
 *
 * Deploy:  supabase functions deploy admin-invite
 *
 * SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected by
 * the platform; no secrets need to be set by hand.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) return json({ error: 'Not signed in.' }, 401)

  // Identify the caller using their own token.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await caller.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'Not signed in.' }, 401)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Authorise: the caller must themselves be an administrator.
  const { data: isAdminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', userData.user.id)
    .maybeSingle()
  if (!isAdminRow) return json({ error: 'You are not an administrator.' }, 403)

  let body: { action?: string; email?: string; user_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400)
  }

  /* ------------------------------------------------------------- invite -- */
  if (body.action === 'invite') {
    const email = (body.email ?? '').trim().toLowerCase()
    if (!email || !email.includes('@')) return json({ error: 'Enter a valid email address.' }, 400)

    // Reuse the account if it already exists, otherwise send an invitation.
    let userId: string | null = null

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email)
    if (invited?.user) {
      userId = invited.user.id
    } else {
      // Most likely "already registered" — find them and just grant access.
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const existing = list?.users?.find((u) => u.email?.toLowerCase() === email)
      if (!existing) {
        return json({ error: inviteErr?.message ?? 'Could not invite that address.' }, 400)
      }
      userId = existing.id
    }

    const { error: insertErr } = await admin
      .from('admins')
      .upsert({ user_id: userId, email, added_by: userData.user.id }, { onConflict: 'user_id' })
    if (insertErr) return json({ error: insertErr.message }, 400)

    return json({ ok: true, user_id: userId, email })
  }

  /* ------------------------------------------------------------- revoke -- */
  if (body.action === 'revoke') {
    const userId = body.user_id
    if (!userId) return json({ error: 'Missing user_id.' }, 400)
    if (userId === userData.user.id) {
      return json({ error: 'You cannot revoke your own access.' }, 400)
    }

    const { count } = await admin
      .from('admins')
      .select('user_id', { count: 'exact', head: true })
    if ((count ?? 0) <= 1) {
      return json({ error: 'There must always be at least one administrator.' }, 400)
    }

    const { error } = await admin.from('admins').delete().eq('user_id', userId)
    if (error) return json({ error: error.message }, 400)

    // The auth account is intentionally left in place — revoking admin rights
    // should not delete a person's login or orphan their audit-log entries.
    return json({ ok: true })
  }

  return json({ error: 'Unknown action.' }, 400)
})
