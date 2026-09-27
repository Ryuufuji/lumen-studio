'use client'

/**
 * Formulaire de connexion.
 *
 * Deux modes sur le même écran, parce qu'ils répondent à deux besoins
 * différents : le mot de passe pour qui travaille tous les jours, le lien
 * magique pour qui vient de s'inscrire et n'a rien d'autre à faire.
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { KeyRound, Loader2, Mail } from 'lucide-react'
import { getSupabaseBrowser } from '@/lib/supabase/client'
import { explainAuthError, isSupabaseConfigured } from '@/lib/supabase/errors'
import { cn } from '@/lib/utils'

type Mode = 'password' | 'magic'

export function LoginForm({ redirectTo = '/editor' }: { redirectTo?: string }) {
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  /** Vrai quand le message provient d'un réseau injoignable, et non d'un
   *  mot de passe refusé : dans ce cas l'éditeur reste accessible et on doit
   *  le proposer. */
  const [offline, setOffline] = useState(false)
  const [pending, startTransition] = useTransition()

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setMessage(null)
    setStatus('idle')
    setOffline(false)

    startTransition(async () => {
      const supabase = getSupabaseBrowser()

      const { error } =
        mode === 'password'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signInWithOtp({
              email,
              options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${redirectTo}` },
            })

      if (error) {
        const feedback = explainAuthError(error)
        setStatus('error')
        setMessage(feedback.message)
        // Le message de Supabase sur des identifiants refusés est déjà clair ;
        // seul un échec réseau a une cause que l'utilisateur ne peut pas
        // deviner. On ne propose l'éditeur que dans ce cas.
        setOffline(feedback.message !== feedback.technical)
        return
      }

      if (mode === 'magic') {
        setMessage('Lien envoyé. Consultez votre boîte de réception.')
      } else {
        window.location.href = redirectTo
      }
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-[var(--radius-panel)] bg-surface-2 p-1">
        {(
          [
            { id: 'password' as const, label: 'Mot de passe', icon: KeyRound },
            { id: 'magic' as const, label: 'Lien magique', icon: Mail },
          ]
        ).map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              setMode(entry.id)
              setMessage(null)
            }}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-[calc(var(--radius-panel)-2px)] px-2 py-1.5 text-xs transition-colors',
              mode === entry.id
                ? 'bg-surface text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            <entry.icon className="size-3.5" />
            {entry.label}
          </button>
        ))}
      </div>

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

      {mode === 'password' && (
        <label className="block space-y-1.5">
          <span className="text-xs text-fg-muted">Mot de passe</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-[var(--radius-panel)] border border-line bg-surface-2 px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
          />
        </label>
      )}

      {message && (
        <p
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
        className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-panel)] bg-accent px-4 py-2.5 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {mode === 'password' ? 'Se connecter' : 'Recevoir le lien'}
      </button>

      <p className="text-center text-[11px] leading-relaxed text-fg-subtle">
        Pas encore de compte ?{' '}
        <Link
          href={`/signup${redirectTo === '/editor' ? '' : `?next=${encodeURIComponent(redirectTo)}`}`}
          className="underline underline-offset-2 hover:text-fg"
        >
          Créez-en un
        </Link>
        , puis revenez ici.
        {!isSupabaseConfigured() && (
          <>
            {' '}
            <span className="text-mask-active">
              Cette build n’est reliée à aucun projet — la connexion est
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
