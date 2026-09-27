'use client'

/**
 * Curseur de réglage fin.
 *
 * Le besoin métier est la haute précision : un pas de 0,01 doit être
 * atteignable à la souris sur une plage de 100 unités. D'où les trois
 * modes de glissement :
 *
 *   glissement normal   → rapide, course 1:1
 *   Maj enfoncé         → × 0,2 — réglage au pixel près
 *   Ctrl/⌘ enfoncé     → × 0,02 — réglage extremely fin
 *
 * Clic droit (ou double-clic) : remise à zéro.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { clamp, cn, formatValue } from '@/lib/utils'
import type { AdjustmentSpec } from '@/types/editor'

interface SliderProps {
  spec: AdjustmentSpec
  value: number
  onChange: (value: number) => void
  /** Appelé au relâchement : c'est là qu'on empile l'historique. */
  onCommit?: () => void
  disabled?: boolean
  className?: string
}

const SPEED = { normal: 1, fine: 0.2, ultra: 0.02 } as const

export function Slider({ spec, value, onChange, onCommit, disabled, className }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragOrigin = useRef({ pointerX: 0, value: 0, speed: 1 })

  const span = spec.max - spec.min || 1
  const ratio = (value - spec.min) / span
  const isDefault = value === spec.default

  const applyPointer = useCallback(
    (event: PointerEvent | React.PointerEvent) => {
      const speed = event.shiftKey ? SPEED.fine : event.ctrlKey || event.metaKey ? SPEED.ultra : SPEED.normal
      const track = trackRef.current
      if (!track) return

      // Le déplacement est relatif : l'amplitude du curseur du système
      // n'intervient pas, donc le réglage est reproductible d'un écran à
      // l'autre.
      const rect = track.getBoundingClientRect()
      const perPixel = span / Math.max(rect.width, 120)
      const delta = (event.clientX - dragOrigin.current.pointerX) * perPixel * speed
      const originSpeed = dragOrigin.current.speed

      // Au premier mouvement, on fige le facteur : appuyer Maj en cours de
      // geste ne doit pas provoquer de saut.
      if (originSpeed !== speed) {
        dragOrigin.current = {
          pointerX: event.clientX,
          value: value,
          speed,
        }
        return
      }

      const next = clamp(dragOrigin.current.value + delta, spec.min, spec.max)
      const rounded = Number(next.toFixed(spec.precision + 2))
      if (rounded !== value) onChange(rounded)
    },
    [onChange, spec.max, spec.min, spec.precision, span, value],
  )

  useEffect(() => {
    if (!dragging) return

    const onMove = (event: PointerEvent) => applyPointer(event)
    const onUp = () => {
      setDragging(false)
      onCommit?.()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [applyPointer, dragging, onCommit])

  const startDrag = (event: React.PointerEvent) => {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    const speed = event.shiftKey ? SPEED.fine : event.ctrlKey || event.metaKey ? SPEED.ultra : SPEED.normal
    dragOrigin.current = { pointerX: event.clientX, value, speed }
    setDragging(true)
  }

  // Saisie clavier : un pas de spec.step par frappe.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const big = event.shiftKey ? 10 : 1
    let next: number | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = value - spec.step * big
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = value + spec.step * big
    if (event.key === 'Home') next = spec.min
    if (event.key === 'End') next = spec.max
    if (next === null) return
    event.preventDefault()
    onChange(clamp(Number(next.toFixed(spec.precision + 2)), spec.min, spec.max))
    onCommit?.()
  }

  const fill = Math.abs(ratio) * 50
  const fillLeft = ratio >= 0 ? 50 : 50 - fill

  return (
    <div className={cn('group/slider select-none', disabled && 'opacity-40', className)}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs text-fg-muted group-hover/slider:text-fg">{spec.label}</span>
        <div className="flex items-baseline gap-1">
          <span
            className={cn(
              'tabular text-xs font-mono',
              isDefault ? 'text-fg-subtle' : value > spec.default ? 'text-clip' : 'text-cyan-accent',
            )}
          >
            {value > 0 ? '+' : ''}
            {formatValue(value, spec.precision)}
            {spec.unit ? <span className="ml-0.5 text-fg-subtle">{spec.unit}</span> : null}
          </span>
          <button
            type="button"
            aria-label={`Réinitialiser ${spec.label}`}
            onClick={() => {
              onChange(spec.default)
              onCommit?.()
            }}
            className="rounded p-0.5 text-fg-subtle opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover/slider:opacity-100"
          >
            <svg viewBox="0 0 8 8" className="size-2" aria-hidden>
              <circle cx="4" cy="4" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={spec.label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={value}
        aria-valuetext={`${formatValue(value, spec.precision)}${spec.unit ?? ''}`}
        onPointerDown={startDrag}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => {
          event.preventDefault()
          onChange(spec.default)
          onCommit?.()
        }}
        onDoubleClick={() => {
          onChange(spec.default)
          onCommit?.()
        }}
        className={cn(
          'relative h-4 cursor-ew-resize touch-none select-none',
          dragging && 'cursor-ew-resize',
        )}
      >
        {/* Rail */}
        <div className="slider-track pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2" />
        {/* Remplissage bipolaire : part du centre, comme dans Lightroom. */}
        <div
          className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: `${fillLeft}%`, width: `${fill}%` }}
        />
        {/* Poignée */}
        <div
          className={cn(
            'pointer-events-none absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent bg-bg transition-transform',
            dragging ? 'scale-125' : 'group-hover/slider:scale-110',
          )}
          style={{ left: `${ratio * 100}%` }}
        />
      </div>
    </div>
  )
}
