'use client'

/**
 * Pile de calques de masque — le panneau façon Photoshop.
 *
 * C'est LE panneau qui manque à la plupart des éditeurs web : on y ajoute un
 * calque, on le sélectionne, et tous les curseurs de droite s'y rattachent.
 */

import { Copy, Eye, EyeOff, Eraser, Layers, Plus, Trash2 } from 'lucide-react'
import { BLEND_MODES, useEditorStore } from '@/store/editor-store'
import { cn } from '@/lib/utils'
import type { MaskLayer } from '@/types/editor'

const KIND_LABEL: Record<MaskLayer['kind'], string> = {
  adjustment: 'Retouche',
  erase: 'Exclusion',
  color: 'Teinte',
  gradient: 'Dégradé',
}

export function LayersPanel() {
  const layers = useEditorStore((s) => s.state.layers)
  const activeLayerId = useEditorStore((s) => s.activeLayerId)
  const addLayer = useEditorStore((s) => s.addLayer)
  const removeLayer = useEditorStore((s) => s.removeLayer)
  const duplicateLayer = useEditorStore((s) => s.duplicateLayer)
  const selectLayer = useEditorStore((s) => s.selectLayer)
  const updateLayer = useEditorStore((s) => s.updateLayer)
  const updateBrush = useEditorStore((s) => s.updateBrush)
  const tool = useEditorStore((s) => s.tool)
  const setTool = useEditorStore((s) => s.setTool)
  const showMask = useEditorStore((s) => s.view.showMask)
  const setView = useEditorStore((s) => s.setView)
  const commit = useEditorStore((s) => s.commit)

  const activeLayer = activeLayerId ? layers.find((l) => l.id === activeLayerId) ?? null : null

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Calques de masque</h2>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => addLayer('adjustment')}
            title="Nouveau calque de retouche"
            className="rounded p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => addLayer('erase')}
            title="Nouveau calque d’exclusion (révèle le dessous)"
            className="rounded p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <Eraser className="size-4" />
          </button>
        </div>
      </header>

      {layers.length === 0 ? (
        <div className="rounded-[var(--radius-panel)] border border-dashed border-line p-6 text-center">
          <Layers className="mx-auto mb-2 size-5 text-fg-subtle" />
          <p className="text-xs leading-relaxed text-fg-subtle">
            Aucun calque. Ajoutez-en un, peignez la zone à retoucher, puis
            réglez-la dans l’onglet de droite.
          </p>
        </div>
      ) : (
        <ul className="space-y-1">
          {[...layers].reverse().map((layer) => {
            const active = layer.id === activeLayerId
            return (
              <li key={layer.id}>
                <div
                  className={cn(
                    'group flex items-center gap-2 rounded-[var(--radius-panel)] border px-2 py-1.5 transition-colors',
                    active
                      ? 'border-accent bg-accent-soft'
                      : 'border-line hover:border-line-strong hover:bg-surface-2',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      selectLayer(layer.id)
                      setTool(layer.kind === 'erase' ? 'eraser' : 'brush')
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="shrink-0 font-mono text-[10px] text-fg-subtle">
                      {KIND_LABEL[layer.kind].slice(0, 3).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs">{layer.name}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      updateLayer(layer.id, { visible: !layer.visible })
                      commit()
                    }}
                    aria-label={layer.visible ? 'Masquer le calque' : 'Afficher le calque'}
                    className="shrink-0 p-1 text-fg-subtle transition-colors hover:text-fg"
                  >
                    {layer.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => duplicateLayer(layer.id)}
                    aria-label="Dupliquer le calque"
                    className="shrink-0 p-1 text-fg-subtle opacity-0 transition-colors hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Copy className="size-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => removeLayer(layer.id)}
                    aria-label="Supprimer le calque"
                    className="shrink-0 p-1 text-fg-subtle opacity-0 transition-colors hover:text-mask-active focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {activeLayer && (
        <section className="space-y-4 border-t border-line pt-4">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
            Calque sélectionné
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-fg-muted">Mode de fusion</span>
              <select
                value={activeLayer.blendMode}
                onChange={(event) => {
                  updateLayer(activeLayer.id, { blendMode: event.target.value as MaskLayer['blendMode'] })
                  commit()
                }}
                className="w-full rounded-[var(--radius-panel)] border border-line bg-surface-2 px-2 py-1.5 text-xs outline-none focus:border-accent"
              >
                {BLEND_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-xs text-fg-muted">Densité</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={activeLayer.density}
                onChange={(event) =>
                  updateLayer(activeLayer.id, { density: Number(event.target.value) })
                }
                onPointerUp={commit}
                className="w-full accent-[var(--accent)]"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-fg-muted">Opacité</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={activeLayer.opacity}
                onChange={(event) =>
                  updateLayer(activeLayer.id, { opacity: Number(event.target.value) })
                }
                onPointerUp={commit}
                className="w-full accent-[var(--accent)]"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-fg-muted">Adoucissement</span>
              <input
                type="range"
                min={0}
                max={120}
                step={0.5}
                value={activeLayer.feather}
                onChange={(event) =>
                  updateLayer(activeLayer.id, { feather: Number(event.target.value) })
                }
                onPointerUp={commit}
                className="w-full accent-[var(--accent)]"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-fg-muted">Taille du pinceau</span>
              <input
                type="number"
                min={1}
                max={500}
                value={activeLayer.brush.size}
                onChange={(event) =>
                  updateBrush(activeLayer.id, { size: Number(event.target.value) })
                }
                onBlur={commit}
                className="tabular w-full rounded-[var(--radius-panel)] border border-line bg-surface-2 px-2 py-1.5 font-mono text-xs outline-none focus:border-accent"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-fg-muted">Dureté</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={activeLayer.brush.hardness}
                onChange={(event) =>
                  updateBrush(activeLayer.id, { hardness: Number(event.target.value) })
                }
                onPointerUp={commit}
                className="w-full accent-[var(--accent)]"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-fg-muted">Débit</span>
              <input
                type="range"
                min={0.01}
                max={1}
                step={0.01}
                value={activeLayer.brush.flow}
                onChange={(event) =>
                  updateBrush(activeLayer.id, { flow: Number(event.target.value) })
                }
                onPointerUp={commit}
                className="w-full accent-[var(--accent)]"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-fg-muted">Espacement</span>
              <input
                type="range"
                min={0.01}
                max={1}
                step={0.01}
                value={activeLayer.brush.spacing}
                onChange={(event) =>
                  updateBrush(activeLayer.id, { spacing: Number(event.target.value) })
                }
                onPointerUp={commit}
                className="w-full accent-[var(--accent)]"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                updateLayer(activeLayer.id, { inverted: !activeLayer.inverted })
                commit()
              }}
              className={cn(
                'rounded-[var(--radius-panel)] border px-2 py-1 text-xs transition-colors',
                activeLayer.inverted
                  ? 'border-accent bg-accent-soft text-fg'
                  : 'border-line text-fg-muted hover:bg-surface-2',
              )}
            >
              Inverser le masque
            </button>

            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('lumen:clear-mask', { detail: activeLayer.id }))
                commit()
              }}
              className="rounded-[var(--radius-panel)] border border-line px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-2"
            >
              Effacer la peinture
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !showMask
                setView({ showMask: next })
                setTool(next ? 'pan' : activeLayer.kind === 'erase' ? 'eraser' : 'brush')
              }}
              className={cn(
                'rounded-[var(--radius-panel)] border px-2 py-1 text-xs transition-colors',
                showMask
                  ? 'border-accent bg-accent-soft text-fg'
                  : 'border-line text-fg-muted hover:bg-surface-2',
              )}
            >
              {showMask ? 'Masque visible' : 'Voir le masque'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
