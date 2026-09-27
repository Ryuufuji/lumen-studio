import type { Metadata } from 'next'
import { SignupForm } from '@/components/auth/signup-form'
import { ThemeSwitcher } from '@/components/ui/theme-switcher'

export const metadata: Metadata = {
  title: 'Inscription',
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  // Même garde que la connexion : on n'accepte qu'un chemin interne, sinon
  // `?next=https://ailleurs.example` ferait une redirection ouverte.
  const redirectTo = next?.startsWith('/') ? next : '/editor'

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
      <div className="w-full max-w-sm">
        <header className="mb-6 space-y-2 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-subtle">
            Lumen Studio
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Créer un compte</h1>
          <p className="text-sm text-fg-muted">
            Pour retrouver vos presets et votre photothèque sur tous vos appareils.
          </p>
        </header>

        <div className="panel rounded-[var(--radius-panel)] p-5">
          <SignupForm redirectTo={redirectTo} />
        </div>
      </div>

      <div className="w-full max-w-sm">
        <ThemeSwitcher />
      </div>
    </main>
  )
}
