import { LoginForm } from '@/components/auth/login-form'
import { ThemeSwitcher } from '@/components/ui/theme-switcher'

export const metadata = {
  title: 'Connexion',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const redirectTo = next?.startsWith('/') ? next : '/editor'

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
      <div className="w-full max-w-sm">
        <header className="mb-6 space-y-2 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-subtle">
            Lumen Studio
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Ravi de vous revoir</h1>
          <p className="text-sm text-fg-muted">
            Connectez-vous pour retrouver vos presets et vos photos.
          </p>
        </header>

        <div className="panel rounded-[var(--radius-panel)] p-5">
          <LoginForm redirectTo={redirectTo} />
        </div>
      </div>

      <div className="w-full max-w-sm">
        <ThemeSwitcher />
      </div>
    </main>
  )
}
