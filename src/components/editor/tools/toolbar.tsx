'use client'

import {
  Brush,
  Circle,
  Columns2,
  Download,
  Eraser,
  Hand,
  MousePointer2,
  Redo2,
  RotateCcw,
  ScanEye,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { cn } from '@/lib/utils'
import type { EditorTool } from '@/types/editor'

const TOOLS: { id: EditorTool; icon: typeof Brush; label: string; shortcut: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Sélection', shortcut: 'V' },
  { id: 'brush', icon: Brush, label: 'Pinceau', shortcut: 'B' },
  { id: 'eraser', icon: Eraser, label: 'Gomme', shortcut: 'E' },
  { id: 'pan', icon: Hand, label: 'Déplacer', shortcut: 'H' },
  { id: 'compare', icon: Columns2, label: 'Avant / après', shortcut: '\\' },
]

export function Toolbar({ onExport }: { onExport?: () => void }) {
  const tool = useEditorStore((s) => s.tool)
  const setTool = useEditorStore((s) => s.setTool)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const past = useEditorStore((s) => s.past.length)
  const future = useEditorStore((s) => s.future.length)
  const reset = useEditorStore((s) => s.reset)
  const toggleCompare = useEditorStore((s) => s.toggleCompare)
  const setView = useEditorStore((s) => s.setView)
  const view = useEditorStore((s) => s.view)
  const canUndo = past > 0
  const canRedo = future > 0

  const onFile = (file: File | undefined) => {
    if (!file?.type.startsWith('image/')) return
    window.dispatchEvent(new CustomEvent('lumen:load-image', { detail: file }))
  }

  return (
    <div className="flex items-center gap-1 border-b border-line bg-surface px-2 py-1.5">
      <label className="flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-panel)] px-2 py-1.5 text-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
        <Upload className="size-4" />
        Ouvrir
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            onFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </label>

      <Divider />

      {TOOLS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => (entry.id === 'compare' ? toggleCompare() : setTool(entry.id))}
          title={`${entry.label} (${entry.shortcut})`}
          aria-pressed={tool === entry.id}
          className={cn(
            'rounded-[var(--radius-panel)] p-1.5 transition-colors',
            tool === entry.id
              ? 'bg-accent-soft text-accent'
              : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
          )}
        >
          <entry.icon className="size-4" />
        </button>
      ))}

      <Divider />

      <button
        type="button"
        onClick={undo}
        disabled={!canUndo}
        title="Annuler (Ctrl+Z)"
        className="rounded-[var(--radius-panel)] p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
      >
        <Undo2 className="size-4" />
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={!canRedo}
        title="Rétablir (Ctrl+Maj+Z)"
        className="rounded-[var(--radius-panel)] p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
      >
        <Redo2 className="size-4" />
      </button>
      <button
        type="button"
        onClick={reset}
        title="Tout réinitialiser"
        className="rounded-[var(--radius-panel)] p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <RotateCcw className="size-4" />
      </button>

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => setView({ zoom: Math.max(0.1, view.zoom / 1.25) })}
        title="Dézoomer"
        className="rounded-[var(--radius-panel)] p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <ZoomOut className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => setView({ zoom: 1, offsetX: 0, offsetY: 0 })}
        title="Ajuster à la fenêtre (100 %)"
        className="tabular rounded-[var(--radius-panel)] px-2 py-1 font-mono text-[11px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        {Math.round(view.zoom * 100)} %
      </button>
      <button
        type="button"
        onClick={() => setView({ zoom: Math.min(32, view.zoom * 1.25) })}
        title="Zoomer"
        className="rounded-[var(--radius-panel)] p-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <ZoomIn className="size-4" />
      </button>

      <button
        type="button"
        onClick={() => setView({ showMask: !view.showMask })}
        title="Voir le masque du calque actif"
        aria-pressed={view.showMask}
        className={cn(
          'rounded-[var(--radius-panel)] p-1.5 transition-colors',
          view.showMask ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        )}
      >
        {view.showMask ? <ScanEye className="size-4" /> : <Circle className="size-4" />}
      </button>

      <Divider />

      <button
        type="button"
        onClick={onExport}
        className="flex items-center gap-1.5 rounded-[var(--radius-panel)] bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
      >
        <Download className="size-3.5" />
        Exporter
      </button>
    </div>
  )
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-line" aria-hidden />
}
