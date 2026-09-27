import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Fusionne des classes Tailwind en résolvant les conflits (`cn`). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Formate un nombre avec un nombre fixe de décimales, sans notation scientifique. */
export function formatValue(value: number, digits = 2): string {
  const abs = Math.abs(value)
  if (abs >= 1000) return value.toFixed(0)
  return value.toFixed(digits)
}

/** Borne une valeur dans un intervalle. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Génère un id court pour les calques de masque côté client. */
export function shortId(prefix = 'm'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

/** Format lisible pour les tailles de fichier. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 o'
  const units = ['o', 'Ko', 'Mo', 'Go']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
