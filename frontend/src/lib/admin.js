import { supabase, SOURCE_BUCKET } from './supabase.js'

/* ------------------------------------------------------------- admin users */

export async function listAdmins() {
  const { data, error } = await supabase
    .from('admins')
    .select('user_id, email, added_at')
    .order('added_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/**
 * Inviting a user requires the service-role key, which must never reach the
 * browser — so it runs in the `admin-invite` Edge Function. The function
 * re-checks that the caller is an admin before doing anything.
 */
export async function inviteAdmin(email) {
  const { data, error } = await supabase.functions.invoke('admin-invite', {
    body: { action: 'invite', email },
  })
  if (error) throw new Error(await readFunctionError(error))
  if (data?.error) throw new Error(data.error)
  return data
}

export async function revokeAdmin(userId) {
  const { data, error } = await supabase.functions.invoke('admin-invite', {
    body: { action: 'revoke', user_id: userId },
  })
  if (error) throw new Error(await readFunctionError(error))
  if (data?.error) throw new Error(data.error)
  return data
}

/** Edge Function errors carry their detail in the response body, not the message. */
async function readFunctionError(error) {
  try {
    const body = await error.context?.json?.()
    if (body?.error) return body.error
  } catch {
    /* fall through */
  }
  return error.message || 'The request failed.'
}

/* ----------------------------------------------------------------- history */

export async function listUploads(limit = 30) {
  const { data, error } = await supabase
    .from('upload_log')
    .select('id, kind, school, action, label, filename, stats, created_at, created_by_email')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export async function logUpload({
  kind, school, label, filename, stats, userId, userEmail, action = 'publish',
}) {
  const { error } = await supabase.from('upload_log').insert({
    kind,
    school: school ?? null,
    action,
    label,
    filename,
    stats,
    created_by: userId ?? null,
    // Denormalised on purpose: the log must stay readable after an account is
    // revoked, and it records who published at the time.
    created_by_email: userEmail ?? null,
  })
  if (error) throw error
}

/* ------------------------------------------------------------ raw workbooks */

/**
 * Keep the original .xlsx so a future parser improvement can be replayed
 * against it without asking anyone to dig the file out of their email.
 * Failure here must not block publishing.
 */
export async function archiveSource(kind, file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safe = file.name.replace(/[^\w.-]+/g, '_')
  const path = `${kind}/${stamp}__${safe}`
  const { error } = await supabase.storage.from(SOURCE_BUCKET).upload(path, file, {
    contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: false,
  })
  if (error) throw error
  return path
}
