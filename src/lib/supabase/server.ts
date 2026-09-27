import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'
import { env } from '@/lib/env'
import type { CookieToSet } from './types'

/**
 * Client Supabase côté serveur (Server Components, Route Handlers, Server Actions).
 *
 * Il est lié aux cookies de la requête courante, ce qui permet :
 *  - de lire la session dans un composant serveur ;
 *  - d'écrire des cookies (rafraîchissement du token) depuis un Server Component.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Écriture impossible : on est hors d'un Server Action / Route Handler
          // (ex. rendu statique). Le middleware rafraîchira la session à la place.
        }
      },
    },
  })
}

/** Raccourci : l'utilisateur connecté, ou `null`. */
export async function getCurrentUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}
