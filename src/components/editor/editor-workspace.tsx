'use client'

/**
 * Espace de travail : assemble la barre d'outils, le canvas WebGL et les
 * panneaux latéraux.
 *
 * Le canvas est le seul détenteur du `Renderer`. Les panneaux n'échangent
 * qu'avec le store Zustand ; les échanges ponctuels (chargement d'une LUT,
 * effacement d'un masque) passent par des événements `window` customs, ce qui
 * évite de perforer le store avec des objets GPU non sérialisables.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ImageIcon } from 'lucide-react'
import { EditorCanvas } from './canvas/editor-canvas'
import { Toolbar } from './tools/toolbar'
import { AdjustmentsPanel } from './panels/adjustments-panel'
import { LayersPanel } from './panels/layers-panel'
import { LutPanel } from './panels/lut-panel'
import { useEditorStore } from '@/store/editor-store'
import { cn } from '@/lib/utils'
import type { PanelId } from '@/types/editor'

const PANELS: { id: PanelId; label: string }[] = [
  { id: 'light', label: 'Réglages' },
  { id: 'color', label: 'Masques' },
  { id: 'luts', label: 'LUTs' },
]

export function EditorWorkspace() {
  const activePanel = useEditorStore((s) => s.activePanel)
  const setPanel = useEditorStore((s) => s.setPanel)
  const layerCount = useEditorStore((s) => s.state.layers.length)

  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const canvasHost = useRef<HTMLDivElement>(null)

  const onExport = useCallback(async () => {
    const host = canvasHost.current
    if (!host) return
    setExporting(true)
    try {
      // Le renderer estupe via l'évènement : le canvas est le seul à le
      // posséder, et il n'est pas dans le même arbre React que ce panneau.
      const blob = await new Promise<Blob>((resolve, reject) => {
        const onDone = (event: Event) => {
          window.removeEventListener('lumen:export-done', onDone)
          const detail = (event as CustomEvent<{ blob?: Blob; error?: string }>).detail
          if (detail?.blob) resolve(detail.blob)
          else reject(new Error(detail?.error ?? 'Export impossible.'))
        }
        window.addEventListener('lumen:export-done', onDone)
        window.dispatchEvent(new CustomEvent('lumen:export'))
      })

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `lumen-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`
      link.click()
      URL.revokeObjectURL(url)
      setInfo('Export terminé.')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }, [])

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <Toolbar onExport={onExport} />

      <div className="flex min-h-0 flex-1">
        {/* Barre d'onglets, à gauche du canvas. */}
        <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-2">
          {PANELS.map((panel) => (
            <button
              key={panel.id}
              type="button"
              onClick={() => setPanel(panel.id)}
              aria-current={activePanel === panel.id}
              className={cn(
                'relative w-full px-1 py-2 text-[10px] font-medium transition-colors',
                activePanel === panel.id
                  ? 'text-accent'
                  : 'text-fg-subtle hover:text-fg',
              )}
            >
              <span className="block [writing-mode:vertical-rl]">{panel.label}</span>
              {panel.id === 'color' && layerCount > 0 && (
                <span className="tabular absolute right-1 top-1 size-3.5 rounded-full bg-accent text-[9px] leading-[14px] text-accent-contrast">
                  {layerCount}
                </span>
              )}
              {activePanel === panel.id && (
                <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" />
              )}
            </button>
          ))}
        </nav>

        {/* Canvas. */}
        <main className="relative min-w-0 flex-1">
          <div ref={canvasHost} className="absolute inset-0">
            <EditorCanvas
              onError={(e) => setError(e.message)}
              onImageLoaded={(width, height) => setInfo(`${width} × ${height} px`)}
            />
          </div>

          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {!info && !error && (
              <p className="flex flex-col items-center gap-2 text-fg-subtle">
                <ImageIcon className="size-8" />
                <span className="text-sm">Glissez une image ici pour commencer</span>
              </p>
            )}
          </div>

          {(error || info) && (
            <div className="absolute left-1/2 top-3 -translate-x-1/2">
              {error ? (
                <p className="flex items-center gap-2 rounded-[var(--radius-panel)] bg-mask-active/90 px-3 py-1.5 text-xs text-white">
                  <AlertTriangle className="size-3.5" />
                  {error}
                </p>
              ) : (
                <p className="rounded-[var(--radius-panel)] bg-black/60 px-3 py-1 font-mono text-[11px] text-white">
                  {info}
                </p>
              )}
            </div>
          )}

          {exporting && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white">
              Encodage en pleine résolution…
            </div>
          )}
        </main>

        {/* Panneau de droite. */}
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-line bg-surface p-4">
          {activePanel === 'light' && <AdjustmentsPanel />}
          {activePanel === 'color' && <LayersPanel />}
          {activePanel === 'luts' && <LutPanel />}
        </aside>
      </div>
    </div>
  )
}

/** Raccourcis clavier globaux de l'éditeur. */
export function useEditorShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const store = useEditorStore.getState()
      const meta = event.ctrlKey || event.metaKey

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (event.key === '\\') {
        event.preventDefault()
        store.toggleCompare()
        return
      }
      switch (event.key.toLowerCase()) {
        case 'v':
          store.setTool('select')
          break
        case 'b':
          store.setTool('brush')
          break
        case 'e':
          store.setTool('eraser')
          break
        case 'h':
          store.setTool('pan')
          break
        case '0':
          store.setView({ zoom: 1, offsetX: 0, offsetY: 0 })
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
