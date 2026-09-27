'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  isThemeId,
  type ThemeId,
} from '@/lib/themes'

interface ThemeContextValue {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
  /** `true` tant que le thème n'a pas été hydraté côté client. */
  pending: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Applique un thème = écrit `data-theme` sur <html>.
 * Le CSS fait le reste (cf. globals.css). Aucun re-render en cascade.
 */
export function ThemeProvider({
  children,
  initialTheme = DEFAULT_THEME,
}: {
  children: React.ReactNode
  initialTheme?: ThemeId
}) {
  const [theme, setThemeState] = useState<ThemeId>(initialTheme)
  const [pending, setPending] = useState(true)

  // Hydratation : relire le choix persisté (le script inline l'a déjà posé
  // sur <html> pour éviter le flash, on aligne simplement l'état React).
  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    const next = isThemeId(stored) ? stored : initialTheme
    setThemeState(next)
    setPending(false)
  }, [initialTheme])

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next)
    localStorage.setItem(THEME_STORAGE_KEY, next)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.style.colorScheme = theme === 'paper' ? 'light' : 'dark'
  }, [theme])

  const value = useMemo(() => ({ theme, setTheme, pending }), [theme, setTheme, pending])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme doit être utilisé dans un <ThemeProvider>')
  return ctx
}

/**
 * Script inline injecté dans <head> : applique le thème AVANT le premier
 * rendu, sinon l'utilisateur voit un éclair de la palette par défaut.
 * Doit rester synchrone et sans dépendance.
 */
export const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');document.documentElement.dataset.theme=s||'${DEFAULT_THEME}';}catch(e){document.documentElement.dataset.theme='${DEFAULT_THEME}';}})()`
