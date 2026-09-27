/**
 * Traduction des erreurs d'authentification en messages comprehensibles.
 *
 * Pourquoi ce module existe : `fetch` echoue silencieusement quand la
 * requete n'atteint aucun serveur, et le navigateur renvoie alors un message
 * technique que personne ne sait interpreter — « Failed to fetch ». Affiche
 * tel quel dans un formulaire de connexion, il laisse l'utilisateur croire a
 * un probleme de mot de passe, alors que le probleme est ailleurs.
 *
 * Deux cas distincts, deux messages distincts :
 *
 *  1. L'application n'a jamais ete configuree (`NEXT_PUBLIC_SUPABASE_URL`
 *     pointe vers l'adresse du stack local). Aucun compte ne peut alors
 *     fonctionner, quel que soit le mot de passe saisi. C'est ce qui arrive
 *     sur une build publiee sans vrai projet derriere.
 *  2. Le projet existe mais est injoignable (reseau coupe, pare-feu).
 *     Les identifiants, eux, n'ont rien a voir.
 */

import { env } from '@/lib/env'

/** Ce que l'utilisateur voit, sans jargon. */
export interface AuthFeedback {
  message: string
  /** Cause technique, pour le journal — jamais affichée telle quelle. */
  technical: string
}

/**
 * L'application pointe-t-elle vers un projet Supabase réel ?
 *
 * `env.isLocal` couvre déjà le cas du stack local (`127.0.0.1:54321`, l'adresse
 * de `npx supabase start`) : c'est la valeur de substitution du modèle, elle
 * permet de lancer l'interface sans backend, mais aucun compte n'existe
 * derrière. Un vrai projet est toujours en `*.supabase.co`.
 */
export function isSupabaseConfigured(): boolean {
  return !env.isLocal && !/example|xxxx|placeholder/i.test(env.supabaseUrl)
}

/** Les messages de `fetch` qui signifient « aucun serveur n'a répondu ». */
function isNetworkFailure(error: unknown): boolean {
  const text = String(
    (error as { message?: string } | null)?.message ?? (error as unknown as string) ?? error,
  ).toLowerCase()
  return (
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('network request failed') ||
    text.includes('load failed') ||
    text.includes('err_internet_disconnected')
  )
}

/**
 * Traduit une erreur renvoyée par `supabase.auth.*` en message affichable.
 *
 * Les erreurs d'identifiants sont laissées telles quelles : Supabase les
 * formule déjà correctement (« Invalid login credentials »).
 */
export function explainAuthError(error: unknown): AuthFeedback {
  const technical = String((error as { message?: string } | null)?.message ?? error)

  if (isNetworkFailure(error)) {
    if (!isSupabaseConfigured()) {
      return {
        message:
          "Cette build n'est reliée à aucun projet. La connexion est indisponible, " +
          "mais la retouche fonctionne : ouvrez l'éditeur directement.",
        technical,
      }
    }
    return {
      message:
        'Impossible de joindre le serveur de connexion. Vérifiez votre connexion ' +
        'réseau, puis réessayez.',
      technical,
    }
  }

  return { message: technical, technical }
}
