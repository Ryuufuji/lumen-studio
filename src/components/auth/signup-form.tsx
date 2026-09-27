'use client'

/**
 * Formulaire d'inscription.
 *
 * La page de connexion renvoie déjà vers ce formulaire — sans lui, un
 * utilisateur sans compte n'avait aucun moyen d'en créer un, quelle que
 * soit la configuration du projet.
 *
 * Deux partis pris :
 *
 *  1. **Confirmation par e-mail obligatoire.** Supabase n'active pas
 *     l'inscription ouverte par défaut ; activer « Confirm email » sans
 *     message de confirmation laisserait l'utilisateur bloqué après avoir
 *     rempli le formulaire. Le message de succès dit explicitement ce qu'il
 *     reste à faire.
 *
 *  2. **Même traduction d'erreurs que la connexion.** Une application
 *     publiée sans projet configuré doit l'expliquer clairement plutôt que
 *     d'afficher « Failed to fetch ».
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Loader2, UserPlus } from 'lucide-react'
import { getSupabaseBrowser } from '@/lib/supabase/client'
import { explainAuthError, isSupabaseConfigured } from '@/lib/supabase/errors'
import { cn } from '@/lib/utils'

export function SignupForm({ redirectTo = '/editor' }: { redirectTo?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'error' | 'done'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [pending, startTransition] = useTransition()

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setMessage(null)
    setStatus('idle')
    setOffline(false)

    startTransition(async () => {
      const supabase = getSupabaseBrowser()

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${redirectTo}`,
        },
      })

      if (error) {
        const feedback = explainAuthError(error)
        setStatus('error')
        setMessage(feedback.message)
        setOffline(feedback.message !== feedback.technical)
        return
      }

      // Confirmation par e-mail activée : une session existe, mais le compte
      // n'est pas encore utilisable. On ne redirige pas, ce qui laisserait
      // croire à un échec.
      if (!data.session) {
        setStatus('done')
        setMessage(
          `Compte créé. Consultez ${email} et cliquez sur le lien de ` +
            `confirmation pour l’activer, puis revenez vous connecter.`,
        )
        return
      }

      window.location.href = redirectTo
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-xs text-fg-muted">Adresse e-mail</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="vous@exemple.com"
          className="w-full rounded-[var(--radius-panel)] border border-line bg-surface-2 px-3 py-2 text-sm outline-none transition-colors placeholder:text-fg-subtle focus:border-accent"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs text-fg-muted">Mot de passe</span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="8 caractères minimum"
          className="w-full rounded-[var(--radius-panel)] border border-line bg-surface-2 px-3 py-2 text-sm outline-none transition-colors placeholder:text-fg-subtle focus:border-accent"
        />
      </label>

      {message && (
        <p
          role="status"
          aria-live="polite"
          className={cn(
            'rounded-[var(--radius-panel)] px-3 py-2 text-xs',
            status === 'error'
              ? 'bg-mask-active/15 text-mask-active'
              : 'bg-accent-soft text-fg',
          )}
        >
          {message}
          {offline && (
            <>
              {' '}
              <Link
                href="/editor"
                className="font-medium underline underline-offset-2 hover:no-underline"
              >
                Ouvrir l&apos;éditeur
              </Link>
            </>
          )}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-panel)] bg-accent px-3 py-2.5 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <UserPlus className="size-4" />
        )}
        Créer un compte
      </button>

      <p className="text-center text-[11px] leading-relaxed text-fg-subtle">
        Déjà un compte ?{' '}
        <Link
          href="/login"
          className="underline underline-offset-2 hover:text-fg"
        >
          Connectez-vous
        </Link>
        .
        {!isSupabaseConfigured() && (
          <>
            {' '}
            <span className="text-mask-active">
              Cette build n’est reliée à aucun projet — l’inscription est
              indisponible, mais{' '}
              <Link href="/editor" className="underline underline-offset-2">
                l’éditeur fonctionne
              </Link>
              .
            </span>
          </>
        )}
      </p>
    </form>
  )
}
