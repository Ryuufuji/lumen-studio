'use client'

/**
 * Panneau des réglages façon Lightroom.
 *
 * Un seul et même jeu de curseurs sert à deux cibles : l'image entière, ou
 * le calque de masque sélectionné. C'est exactement le modèle de Lightroom
 * (« Outil de développement » / « Réglages locaux »), et ça évite d'entretenir
 * deux listes de contrôles.
 */

import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { ADJUSTMENT_SPECS } from '@/lib/editor/schema'
import { useEditorStore } from '@/store/editor-store'
import { cn } from '@/lib/utils'
import type { AdjustableKey, BasicAdjustments } from '@/types/editor'

const GROUPS: { title: string; keys: AdjustableKey[] }[] = [
  {
    title: 'Lumière',
    keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'brightness'],
  },
  {
    title: 'Couleur',
    keys: ['temperature', 'tint', 'vibrance', 'saturation'],
  },
  {
    title: 'Détails',
    keys: ['texture', 'clarity', 'dehaze', 'sharpness'],
  },
  {
    title: 'Effets',
    keys: ['grain', 'vignette'],
  },
]

const TONE_MAPS: { id: BasicAdjustments['tonemap']; label: string }[] = [
  { id: 'none', label: 'Aucun' },
  { id: 'reinhard', label: 'Reinhard' },
  { id: 'filmic', label: 'Filmic' },
  { id: 'aces', label: 'ACES' },
]

export function AdjustmentsPanel() {
  const global = useEditorStore((s) => s.state.adjustments)
  const layers = useEditorStore((s) => s.state.layers)
  const activeLayerId = useEditorStore((s) => s.activeLayerId)
  const setAdjustment = useEditorStore((s) => s.setAdjustment)
  const setAdjustments = useEditorStore((s) => s.setAdjustments)
  const setToneMap = useEditorStore((s) => s.setToneMap)
  const commit = useEditorStore((s) => s.commit)
  const reset = useEditorStore((s) => s.reset)

  const activeLayer = activeLayerId ? layers.find((l) => l.id === activeLayerId) ?? null : null
  const local = activeLayer?.adjustments ?? null
  const values = (local ?? global) as BasicAdjustments

  const set = (key: AdjustableKey, value: number) => {
    if (activeLayer) useEditorStore.getState().updateLayerAdjustments(activeLayer.id, { [key]: value })
    else setAdjustment(key, value)
  }

  const resetGroup = () => {
    if (activeLayer) {
      const patch: Partial<BasicAdjustments> = {}
      for (const { keys } of GROUPS) for (const key of keys) patch[key] = 0
      useEditorStore.getState().updateLayerAdjustments(activeLayer.id, patch)
    } else {
      const patch: Partial<BasicAdjustments> = {}
      for (const spec of ADJUSTMENT_SPECS) patch[spec.key] = spec.default
      setAdjustments(patch)
    }
    commit()
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">
            {activeLayer ? `Calque — ${activeLayer.name}` : 'Réglages globaux'}
          </h2>
          <p className="truncate text-xs text-fg-subtle">
            {activeLayer
              ? 'Les réglages s’appliquent uniquement dans la zone peinte.'
              : 'Les réglages s’appliquent à toute l’image.'}
          </p>
        </div>
        <button
          type="button"
          onClick={activeLayer ? resetGroup : reset}
          title="Réinitialiser"
          className="rounded p-1.5 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <RotateCcw className="size-4" />
        </button>
      </header>

      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-3">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
            {group.title}
          </h3>
          {group.keys.map((key) => {
            const spec = ADJUSTMENT_SPECS.find((s) => s.key === key)!
            return (
              <Slider
                key={key}
                spec={spec}
                value={values[key]}
                onChange={(value) => set(key, value)}
                onCommit={commit}
              />
            )
          })}
        </section>
      ))}

      <section className="space-y-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
          Tone mapping
        </h3>
        <div className="grid grid-cols-4 gap-1 rounded-[var(--radius-panel)] bg-surface-2 p-1">
          {TONE_MAPS.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => {
                if (activeLayer) {
                  useEditorStore
                    .getState()
                    .updateLayer(activeLayer.id, {
                      adjustments: { ...activeLayer.adjustments, tonemap: mode.id },
                    })
                } else {
                  setToneMap(mode.id)
                }
                commit()
              }}
              className={cn(
                'rounded px-1 py-1 text-[11px] transition-colors',
                values.tonemap === mode.id
                  ? 'bg-accent text-accent-contrast'
                  : 'text-fg-muted hover:bg-surface-3 hover:text-fg',
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] leading-snug text-fg-subtle">
          Le tone mapping comprime les hautes lumières au lieu de les écrêter.
          À activer sur une image très contrastée, jamais en retouche courante.
        </p>
      </section>

      {!activeLayer && (
        <p className="flex items-start gap-2 rounded-[var(--radius-panel)] bg-surface-2 p-3 text-[11px] leading-snug text-fg-subtle">
          <SlidersHorizontal className="mt-0.5 size-3.5 shrink-0" />
          Sélectionnez un calque de masque dans l’onglet « Masques » pour
          retoucher une zone précise. Les curseurs se redirigeront
          automatiquement.
        </p>
      )}
    </div>
  )
}
