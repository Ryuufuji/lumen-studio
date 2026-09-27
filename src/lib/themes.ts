/**
 * Catalogue des thèmes de l'application.
 * Les valeurs réelles vivent dans `src/app/globals.css` (variables CSS) :
 * ce fichier ne décrit que l'identité et l'aperçu du sélecteur.
 */
export const THEME_IDS = ['pro-dark', 'glassmorphism', 'adobe-classic', 'paper'] as const

export type ThemeId = (typeof THEME_IDS)[number]

export interface ThemeDefinition {
  id: ThemeId
  label: string
  description: string
  /** Couleurs de la vignette d'aperçu. */
  preview: { base: string; panel: string; accent: string; border: string }
  /** `color-scheme` appliqué au navigateur. */
  scheme: 'light' | 'dark'
}

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: 'pro-dark',
    label: 'Pro Dark',
    description: 'Sombre, minimaliste, contrastes froids. Le standard pour juger une image.',
    preview: { base: '#08090b', panel: '#15181d', accent: '#4c8dff', border: '#23272f' },
    scheme: 'dark',
  },
  {
    id: 'glassmorphism',
    label: 'Glassmorphism',
    description: 'Translucide, flou d\'arrière-plan, liserés lumineux.',
    preview: { base: '#0b1020', panel: 'rgba(255,255,255,0.12)', accent: '#7c8cff', border: 'rgba(255,255,255,0.3)' },
    scheme: 'dark',
  },
  {
    id: 'adobe-classic',
    label: 'Adobe Classic',
    description: 'Gris neutre professionnel, densité élevée, à la Camera Raw.',
    preview: { base: '#232323', panel: '#333333', accent: '#3d7dca', border: '#3a3a3a' },
    scheme: 'dark',
  },
  {
    id: 'paper',
    label: 'Paper',
    description: 'Texture grainée, couleurs chaudes, faible contraste.',
    preview: { base: '#f2ece1', panel: '#faf6ee', accent: '#b4622a', border: '#ded4c2' },
    scheme: 'light',
  },
] as const

export const DEFAULT_THEME: ThemeId = 'pro-dark'

export const THEME_STORAGE_KEY = 'lumen:theme'

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
}

export function getTheme(id: ThemeId): ThemeDefinition {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]!
}
