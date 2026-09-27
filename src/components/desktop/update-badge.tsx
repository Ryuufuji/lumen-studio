'use client'

/**
 * Pastille de mise à jour.
 *
 * Règle absolue : ce composant ne bloque jamais l'édition. Pas de modale, pas
 * de bouton « Installer maintenant », pas de compte à rebours. La mise à jour
 * se télécharge en arrière-plan et s'installe à la fermeture — une retouche en
 * cours n'est jamais interrompue.
 *
 * Ce que voit l'utilisateur, donc :
 *   - rien, la plupart du temps ;
 *   - un point pulsé, quand un téléchargement est en cours ;
 *   - une ligne discrète « mise à jour prête », jusqu'au prochain démarrage.
 *
 * L'état `error` est volontairement MUET : un miroir indisponible ou une
 * coupure réseau ne concerne pas l'utilisateur, et une alerte rouge dans un
 * éditeur de photo serait du bruit.
 */

import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@/types/electron'

/** En dessous de cette durée, afficher « téléchargement » serait du battement
 *  d'interface pour rien : on n'apparaît qu'au-delà d'une seconde. */
const FLASH_MS = 1000

export function UpdateBadge() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Hors Electron (navigateur, `next dev` dans un onglet), il n'y a rien à
    // écouter : le composant ne rend alors jamais rien.
    const bridge = window.lumen
    if (!bridge) return

    let timer: ReturnType<typeof setTimeout> | undefined
    let pending: UpdateStatus | null = null

    const flush = () => {
      timer = undefined
      setStatus(pending)
      setVisible(pending !== null)
    }

    const unsubscribe = bridge.onUpdateStatus((next) => {
      const quiet = next.state === 'idle' || next.state === 'unsupported'
      // `ready` est une information durable (elle tient jusqu'au
      // redémarrage) et une erreur doit rester consultable : on les affiche
      // tout de suite. Les états de passage — `checking`, `downloading` —
      // sont coalescés, sinon la pastille scintille à chaque événement.
      const instant = quiet || next.state === 'ready' || next.state === 'error'

      if (timer) clearTimeout(timer)

      if (instant) {
        pending = quiet ? null : next
        flush()
        return
      }

      pending = next
      timer = setTimeout(flush, FLASH_MS)
    })

    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [])

  if (!visible || !status) return null

  const { state, version } = status

  if (state === 'ready') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-[var(--radius-panel)] border border-line bg-surface/95 px-2.5 py-1.5 text-[11px] text-fg-muted shadow-[var(--shadow-panel)] backdrop-blur-sm"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
        Mise à jour{version ? ` ${version}` : ''} installée au prochain démarrage
      </div>
    )
  }

  // checking | downloading
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-[var(--radius-panel)] border border-line bg-surface/95 px-2.5 py-1.5 text-[11px] text-fg-muted shadow-[var(--shadow-panel)] backdrop-blur-sm"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fg-subtle" aria-hidden="true" />
      {status.state === 'downloading' && typeof status.percent === 'number'
        ? `Mise à jour · ${status.percent} %`
        : 'Mise à jour…'}
    </div>
  )
}
