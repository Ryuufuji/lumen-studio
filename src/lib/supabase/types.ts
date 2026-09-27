import type { CookieOptions } from '@supabase/ssr'

/** Entrée du tableau `setAll` fourni par @supabase/ssr. */
export type CookieToSet = {
  name: string
  value: string
  options?: CookieOptions
}
