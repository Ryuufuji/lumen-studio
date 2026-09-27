import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Tout ce qui est servi statiquement depuis `public/` DOIT ignorer le
     * middleware. La bibliothèque de LUTs est volontairement publique — elle
     * est livrée avec l'application, pas derrière le compte de l'utilisateur.
     * Sans cette exclusion, `catalog.json` reçoit une redirection 307 vers
     * /login et le navigateur de LUT reste vide.
     *
     * Le motif exclut donc les préfixes (_next, luts) ET les extensions de
     * fichiers statiques, plutôt que de lister les assets un par un.
     */
    '/((?!_next/static|_next/image|luts/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|cube|json|txt|webmanifest|woff|woff2|mp4)$).*)',
  ],
}
