import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/types/database'
import { env } from '@/lib/env'
import type { CookieToSet } from './types'

/**
 * Rafraîchit la session Supabase à chaque requête et propage les cookies
 * mis à jour vers le navigateur.
 *
 * Pourquoi dans le middleware ? Parce que les Server Components ne peuvent pas
 * écrire de cookies. Sans ce rafraîchissement, un access token expiré
 * provoquerait des « logged out » aléatoires en pleine session.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: CookieToSet[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        supabaseResponse = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options)
        }
      },
    },
  })

  // DOIT être appelé : c'est lui qui déclenche le refresh si le token expire.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && !isPublicRoute(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname + request.nextUrl.search)
    return NextResponse.redirect(url)
  }

  if (user && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/editor'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

/**
 * Routes atteignables sans compte.
 *
 * `/editor` en fait partie, et c'est délibéré : la retouche est 100 % locale
 * (rendu WebGL, LUTs livrées avec l'application). Aucun de ses composants ne
 * parle à Supabase. La bloquer derriere une authentification n'apporterait
 * aucune sécurité — cela Rendrait seulement l'application inutilisable tant
 * qu'aucun projet n'est configuré.
 *
 * La photothèque, les presets et l'académie, eux, restent proteges : ils
 * lectures et écrivent des donnees sur le compte.
 */
const PUBLIC_ROUTES = [
  '/',
  '/editor',
  '/login',
  '/signup',
  '/auth/callback',
  '/auth/auth-code-error',
]

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}
