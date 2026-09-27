'use client'

/**
 * Surface de travail.
 *
 * Le composant ne fait QUE trois choses : instancier le moteur, convertir les
 * événements DOM en coordonnées image, et redessiner quand l'état change.
 * Toute la logique de rendu vit dans `src/lib/gl`.
 *
 * Point de performance : le rendu est piloté par un `requestAnimationFrame`
 * qui ne s'exécute QUE si quelque chose a changé (drapeau `dirty`). Faire un
 * Rendre quand personne n'a rien demandé à 60 fps consomme un iGPU pour rien
 * et fait chauffer les machines portables.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_VIEW, Renderer, viewRect } from '@/lib/gl/renderer'
import { loadImageBitmap } from '@/lib/gl/texture'
import type { LutSource } from '@/lib/lut/library'
import { useEditorStore } from '@/store/editor-store'
import type { ViewState } from '@/lib/gl/renderer'
import { cn } from '@/lib/utils'
import type { EditorTool } from '@/types/editor'

export interface EditorCanvasProps {
  className?: string
  onImageLoaded?: (width: number, height: number) => void
  onError?: (error: Error) => void
}

type DragMode = 'none' | 'paint' | 'pan' | 'split'

export function EditorCanvas({ className, onImageLoaded, onError }: EditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<Renderer | null>(null)

  const state = useEditorStore((s) => s.state)
  const tool = useEditorStore((s) => s.tool)
  const view = useEditorStore((s) => s.view)
  const activeLayerId = useEditorStore((s) => s.activeLayerId)

  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [dropped, setDropped] = useState(false)

  // Références mutables : le paint ne doit pas reconstruire la boucle rAF.
  const drag = useRef<DragMode>('none')
  const last = useRef<{ x: number; y: number } | null>(null)
  const dirty = useRef(true)
  const rafId = useRef(0)

  const invalidate = useCallback(() => {
    dirty.current = true
  }, [])

  /* ---------------------------------------------------------------------
   * Instanciation
   * ------------------------------------------------------------------ */

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: Renderer
    try {
      renderer = new Renderer(canvas)
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)))
      return
    }
    rendererRef.current = renderer

    const loop = () => {
      const shell = shellRef.current
      if (shell && renderer.hasImage) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const width = Math.max(1, Math.floor(shell.clientWidth * dpr))
        const height = Math.max(1, Math.floor(shell.clientHeight * dpr))
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
          dirty.current = true
        }
        if (dirty.current) {
          renderer.render(
            useEditorStore.getState().state,
            useEditorStore.getState().view,
            width,
            height,
          )
          dirty.current = false
        }
      } else if (dirty.current) {
        renderer.render(state, DEFAULT_VIEW, canvas.width, canvas.height)
        dirty.current = false
      }
      rafId.current = requestAnimationFrame(loop)
    }

    rafId.current = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafId.current)
      renderer.dispose()
      rendererRef.current = null
    }
    // Instanciation unique : l'état est lu via `getState()` dans la boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Toute mutation d'état ou de vue invalide le rendu.
  useEffect(invalidate, [state, view, activeLayerId, invalidate])

  /* ---------------------------------------------------------------------
   * Chargement
   * ------------------------------------------------------------------ */

  const loadFile = useCallback(
    async (file: File) => {
      const renderer = rendererRef.current
      if (!renderer) return
      try {
        const bitmap = await loadImageBitmap(file)
        await renderer.setImage(bitmap)
        bitmap.close?.()
        useEditorStore.getState().setView({ zoom: 1, offsetX: 0, offsetY: 0 })
        onImageLoaded?.(renderer.size[0], renderer.size[1])
        invalidate()
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    },
    [invalidate, onImageLoaded, onError],
  )

  // Exposé pour le glisser-déposer de la barre d'outils.
  useEffect(() => {
    const handler = (event: Event) => void loadFile((event as CustomEvent<File>).detail)
    window.addEventListener('lumen:load-image', handler)
    return () => window.removeEventListener('lumen:load-image', handler)
  }, [loadFile])

  /* ---------------------------------------------------------------------
   * Passerelle avec le reste de l'UI
   * -------------------------------------------------------------------
   * Le canvas est le seul possesseur du `Renderer`, qui contient des objets
   * GPU non sérialisables : impossible de le mettre dans le store Zustand.
   * On passe donc par des évènements, avec un unique point de contact.
   * ------------------------------------------------------------------ */

  useEffect(() => {
    const onExport = async (event: Event) => {
      const done = (detail: { blob?: Blob; error?: string }) =>
        window.dispatchEvent(new CustomEvent('lumen:export-done', { detail }))
      try {
        done({ blob: await rendererRef.current!.exportBlob('image/jpeg', 0.95) })
      } catch (e: unknown) {
        done({ error: e instanceof Error ? e.message : String(e) })
      }
    }

    const onClearMask = (event: Event) => {
      const id = (event as CustomEvent<string>).detail
      const layer = useEditorStore.getState().state.layers.find((l) => l.id === id)
      if (layer) rendererRef.current?.clearMask(layer)
      invalidate()
    }

    const onRequestLut = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          key: string
          url: string
          size: number
          source?: LutSource
        }>
      ).detail
      const renderer = rendererRef.current
      if (!renderer) return

      void (async () => {
        try {
          const source: LutSource = detail.source
            ? detail.source
            : { kind: 'url', url: detail.url, title: detail.key }
          const gpu = await renderer.lutCache.acquire(detail.key, source)
          renderer.setLut(gpu)
          invalidate()
        } catch (e: unknown) {
          window.dispatchEvent(
            new CustomEvent('lumen:export-done', { detail: { error: String(e) } }),
          )
        }
      })()
    }

    const onReleaseLut = (event: Event) => {
      rendererRef.current?.lutCache.release((event as CustomEvent<string>).detail)
    }

    window.addEventListener('lumen:export', onExport)
    window.addEventListener('lumen:clear-mask', onClearMask)
    window.addEventListener('lumen:request-lut', onRequestLut)
    window.addEventListener('lumen:release-lut', onReleaseLut)

    return () => {
      window.removeEventListener('lumen:export', onExport)
      window.removeEventListener('lumen:clear-mask', onClearMask)
      window.removeEventListener('lumen:request-lut', onRequestLut)
      window.removeEventListener('lumen:release-lut', onReleaseLut)
    }
  }, [invalidate])

  /* ---------------------------------------------------------------------
   * Conversions
   * ------------------------------------------------------------------ */

  const toImageCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    const renderer = rendererRef.current
    if (!canvas || !renderer?.hasImage) return null

    const rect = canvas.getBoundingClientRect()
    const [imageWidth, imageHeight] = renderer.size
    const dpr = canvas.width / rect.width
    const viewState = useEditorStore.getState().view

    const frame = viewRect(viewState, canvas.width, canvas.height, imageWidth, imageHeight)

    // Écran → fraction d'image. Le y est inversé une seule fois, ici.
    const x = (clientX - rect.left) * dpr
    const y = (clientY - rect.top) * dpr
    const u = (x - frame.x) / frame.width
    const v = 1 - (y - frame.y) / frame.height

    return { x: u * imageWidth, y: v * imageHeight, u, v }
  }, [])

  /* ---------------------------------------------------------------------
   * Interactions
   * ------------------------------------------------------------------ */

  const activeLayer = activeLayerId
    ? state.layers.find((layer) => layer.id === activeLayerId) ?? null
    : null

  const isPaintTool = tool === 'brush' || tool === 'eraser'

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.setPointerCapture(event.pointerId)

      const store = useEditorStore.getState()

      // Molette / clic droit / outil panoramique → déplacement.
      if (event.button === 1 || event.button === 2 || tool === 'pan') {
        drag.current = 'pan'
        last.current = { x: event.clientX, y: event.clientY }
        return
      }

      if (view.split >= 0 && event.clientX - canvas.getBoundingClientRect().left < 24) {
        drag.current = 'split'
        return
      }

      if (isPaintTool && activeLayer) {
        drag.current = 'paint'
        const point = toImageCoords(event.clientX, event.clientY)
        if (point) {
          // Calques d'exclusion : le pinceau efface par défaut.
          if (activeLayer.kind === 'erase') {
            store.updateBrush(activeLayer.id, { erase: !activeLayer.brush.erase })
          }
          const layer = useEditorStore.getState().state.layers.find((l) => l.id === activeLayer.id)!
          rendererRef.current?.paintStroke(layer, point.x, point.y, point.x, point.y, event.pressure || 1)
          last.current = { x: event.clientX, y: event.clientY }
          invalidate()
        }
        return
      }

      last.current = { x: event.clientX, y: event.clientY }
    },
    [activeLayer, isPaintTool, tool, view.split, toImageCoords, invalidate],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      setCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top })

      const point = toImageCoords(event.clientX, event.clientY)
      if (!point) return

      if (drag.current === 'paint' && activeLayer) {
        const previous = last.current
        const layer = useEditorStore.getState().state.layers.find((l) => l.id === activeLayer.id)
        if (layer && previous) {
          const from = toImageCoords(previous.x, previous.y)
          if (from) {
            rendererRef.current?.paintStroke(
              layer,
              from.x,
              from.y,
              point.x,
              point.y,
              event.pressure || 1,
            )
            last.current = { x: event.clientX, y: event.clientY }
            invalidate()
          }
        }
        return
      }

      if (drag.current === 'pan' || event.buttons === 4) {
        const previous = last.current
        if (!previous) return
        const store = useEditorStore.getState()
        const dpr = canvas.width / rect.width
        store.setView({
          offsetX: store.view.offsetX + ((event.clientX - previous.x) * dpr) / canvas.width,
          offsetY: store.view.offsetY - ((event.clientY - previous.y) * dpr) / canvas.height,
        })
        last.current = { x: event.clientX, y: event.clientY }
        return
      }

      if (drag.current === 'split') {
        const fraction = (event.clientX - rect.left) / rect.width
        useEditorStore.getState().setView({ split: fraction })
      }
    },
    [activeLayer, toImageCoords, invalidate],
  )

  const endDrag = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag.current === 'paint') {
      useEditorStore.getState().commit()
    }
    drag.current = 'none'
    last.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }, [])

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      const store = useEditorStore.getState()
      if (event.ctrlKey || event.metaKey || !store.view.split) {
        event.preventDefault()
        // Zoom centré sur le curseur : on compense le panoramique pour que
        // le point sous la souris reste immobile.
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const factor = Math.exp(-event.deltaY * 0.0015)
        const nextZoom = Math.min(32, Math.max(0.05, store.view.zoom * factor))
        const ratio = nextZoom / store.view.zoom
        const cx = (event.clientX - rect.left) / rect.width - 0.5
        const cy = (event.clientY - rect.top) / rect.height - 0.5
        store.setView({
          zoom: nextZoom,
          offsetX: (store.view.offsetX - cx) * ratio + cx,
          offsetY: (store.view.offsetY - cy) * ratio + cy,
        })
      }
    },
    [],
  )

  /* ---------------------------------------------------------------------
   * Déposer un fichier
   * ------------------------------------------------------------------ */

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setDropped(false)
      const file = event.dataTransfer.files?.[0]
      if (file?.type.startsWith('image/')) void loadFile(file)
    },
    [loadFile],
  )

  const brushRadius = activeLayer ? activeLayer.brush.size / 2 : 30

  return (
    <div
      ref={shellRef}
      className={cn(
        'relative isolate h-full w-full overflow-hidden bg-bg',
        drag.current === 'pan' ? 'cursor-grabbing' : isPaintTool ? 'cursor-none' : 'cursor-default',
        dropped && 'ring-2 ring-inset ring-accent',
      )}
      onDragOver={(event) => {
        event.preventDefault()
        setDropped(true)
      }}
      onDragLeave={() => setDropped(false)}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        className="block size-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setCursor(null)}
        onWheel={onWheel}
        onContextMenu={(event) => event.preventDefault()}
        // La molette seule fait défiler la page : on la reserve au zoom.
        style={{ touchAction: 'none' }}
      />

      {/* Cercle du pinceau — le curseur système est masqué (`cursor-none`). */}
      {isPaintTool && cursor && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-full border border-white/80 mix-blend-difference"
          style={{
            left: cursor.x - brushRadius,
            top: cursor.y - brushRadius,
            width: brushRadius * 2,
            height: brushRadius * 2,
          }}
        />
      )}

      {/* Poignée du comparateur avant / après. */}
      {view.split >= 0 && (
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{ left: `${view.split * 100}%` }}
        >
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
            ⇤
          </span>
        </div>
      )}
    </div>
  )
}

export type { ViewState }
