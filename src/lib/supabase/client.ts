'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'
import { env } from '@/lib/env'

/**
 * Client Supabase pour le navigateur.
 *
 * La session est stockée dans des COOKIES (et non localStorage) : c'est ce qui
 * permet au middleware et aux Server Components de lire l'utilisateur courant
 * et d'éviter tout flash de contenu non authentifié.
 */
export function createClient() {
  return createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey)
}

let browserClient: ReturnType<typeof createClient> | undefined

/** Instance partagée — un seul client par onglet. */
export function getSupabaseBrowser() {
  if (!browserClient) browserClient = createClient()
  return browserClient
}
