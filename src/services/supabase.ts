import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/**
 * Null when Supabase isn't configured: the app then runs local-only on IndexedDB, as before.
 * The publishable key is safe in the bundle; row-level security (supabase/schema.sql) protects the data.
 */
export const supabase = url && key ? createClient(url, key) : null

export async function accessToken() {
  return (await supabase?.auth.getSession())?.data.session?.access_token
}
