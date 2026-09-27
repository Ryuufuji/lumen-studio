import Link from 'next/link'
import { ThemeSwitcher } from '@/components/ui/theme-switcher'

/**
 * Page d'atterrissage minimale. Elle sert surtout de démonstration du
 * système de thèmes : les quatre palettes doivent être visibles ici.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 p-8">
      <header className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
          Lumen Studio
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          Retouche photo non destructive,
          <br />
          dans le navigateur.
        </h1>
        <p className="max-w-xl text-fg-muted">
          Calques de masque façon Photoshop, colorimétrie façon Lightroom, LUTs 3D appliqués
          par shader WebGL. Squelette applicatif en place.
        </p>
      </header>

      <section className="panel rounded-[var(--radius-panel)] p-6">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-fg-subtle">
          Thèmes
        </h2>
        <ThemeSwitcher />
      </section>

      <footer className="flex flex-wrap gap-3 text-sm">
        <Link
          href="/login"
          className="rounded-[var(--radius-panel)] bg-accent px-4 py-2 font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
        >
          Connexion
        </Link>
        <span className="rounded-[var(--radius-panel)] border border-line px-4 py-2 text-fg-subtle">
          /editor · /presets · /gallery · /academy — phases suivantes
        </span>
      </footer>
    </main>
  )
}
