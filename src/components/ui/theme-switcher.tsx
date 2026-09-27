'use client'

import { Check } from 'lucide-react'
import { useTheme } from '@/components/providers/theme-provider'
import { THEMES, type ThemeId } from '@/lib/themes'
import { cn } from '@/lib/utils'

/**
 * Sélecteur de thème.
 * Chaque carte affiche les couleurs réelles du thème (lues dans la
 * définition), pas une image : la vignette reste nette à toutes les résolutions.
 */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()

  return (
    <div
      role="radiogroup"
      aria-label="Thème de l'interface"
      className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-4', className)}
    >
      {THEMES.map((definition) => {
        const active = theme === definition.id
        return (
          <button
            key={definition.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(definition.id as ThemeId)}
            className={cn(
              'group flex flex-col gap-3 rounded-[var(--radius-panel)] border p-3 text-left transition-all',
              active
                ? 'border-accent bg-accent-soft'
                : 'border-line hover:border-line-strong hover:bg-surface-2',
            )}
          >
            {/* Vignette */}
            <div
              className="flex h-20 flex-col justify-between rounded-sm border p-2"
              style={{
                backgroundColor: definition.preview.base,
                borderColor: definition.preview.border,
              }}
              aria-hidden
            >
              <div className="flex gap-1">
                <div
                  className="h-1.5 flex-1 rounded-full"
                  style={{ backgroundColor: definition.preview.accent }}
                />
                <div
                  className="h-1.5 w-6 rounded-full"
                  style={{ backgroundColor: definition.preview.border }}
                />
              </div>
              <div
                className="h-6 rounded-sm"
                style={{ backgroundColor: definition.preview.panel }}
              />
              <div className="flex gap-1">
                <div
                  className="h-1.5 w-10 rounded-full"
                  style={{ backgroundColor: definition.preview.border }}
                />
              </div>
            </div>

            <div className="space-y-0.5">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                {definition.label}
                {active && <Check className="h-3.5 w-3.5 text-accent" />}
              </p>
              <p className="text-xs leading-snug text-fg-subtle">{definition.description}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}
