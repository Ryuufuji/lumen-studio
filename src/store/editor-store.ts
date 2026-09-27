'use client'

import { create } from 'zustand'
import {
  clampAdjustments,
  defaultAdjustments,
  defaultCurves,
  defaultEditorState,
  defaultHsl,
  defaultLut,
  defaultMaskLayer,
  parseEditorState,
} from '@/lib/editor/schema'
import type {
  AdjustableKey,
  BasicAdjustments,
  BlendMode,
  BrushSettings,
  Curves,
  EditorState,
  EditorTool,
  HslBand,
  HslMap,
  LutReference,
  MaskLayer,
  PanelId,
} from '@/types/editor'

/** Profondeur d'historique : au-delà, on courtise le GC pour rien. */
const HISTORY_LIMIT = 80

export interface EditorStore {
  state: EditorState
  tool: EditorTool
  activePanel: PanelId
  activeLayerId: string | null
  view: {
    zoom: number
    offsetX: number
    offsetY: number
    split: number
    showMask: boolean
  }

  /** Poussé avant chaque mutation groupee (glissement de slider, trait). */
  past: EditorState[]
  future: EditorState[]

  /* --- Réglages --- */
  setAdjustment: (key: AdjustableKey, value: number) => void
  setAdjustments: (patch: Partial<BasicAdjustments>) => void
  setHslBand: (band: HslBand, patch: Partial<HslMap[HslBand]>) => void
  setHsl: (hsl: HslMap) => void
  setCurves: (curves: Curves) => void
  setToneMap: (mode: BasicAdjustments['tonemap']) => void

  /* --- LUT --- */
  setLut: (lut: Partial<LutReference>) => void
  clearLut: () => void

  /* --- Calques de masque --- */
  addLayer: (kind?: MaskLayer['kind']) => string
  removeLayer: (id: string) => void
  duplicateLayer: (id: string) => void
  selectLayer: (id: string | null) => void
  updateLayer: (id: string, patch: Partial<MaskLayer>) => void
  updateLayerAdjustments: (id: string, patch: Partial<BasicAdjustments>) => void
  updateBrush: (id: string, patch: Partial<BrushSettings>) => void
  reorderLayer: (id: string, direction: -1 | 1) => void

  /* --- Outils & vue --- */
  setTool: (tool: EditorTool) => void
  setPanel: (panel: PanelId) => void
  setView: (patch: Partial<EditorStore['view']>) => void
  toggleCompare: () => void

  /* --- Historique --- */
  commit: () => void
  undo: () => void
  redo: () => void
  reset: () => void
  replace: (state: EditorState, options?: { history?: boolean }) => void
}

/** Applique un patch sur les réglages sans casser les bornes. */
function patchAdjustments(
  current: BasicAdjustments,
  patch: Partial<BasicAdjustments>,
): BasicAdjustments {
  return clampAdjustments({ ...current, ...patch })
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  state: defaultEditorState(),
  tool: 'select',
  activePanel: 'light',
  activeLayerId: null,
  view: { zoom: 1, offsetX: 0, offsetY: 0, split: -1, showMask: false },
  past: [],
  future: [],

  /* ------------------------------------------------------------------ */

  setAdjustment(key, value) {
    const { state, commit, past } = get()
    // On n'empile un point d'historique que si la valeur change vraiment.
    if (state.adjustments[key] === value) return
    set({
      state: {
        ...state,
        adjustments: { ...state.adjustments, [key]: value },
      },
      // Un glissement de slider ne doit pas remplir l'historique ligne à
      // ligne : le composant appelle `commit()` au relâchement.
      past: past.length >= HISTORY_LIMIT ? past.slice(1) : past,
    })
  },

  setAdjustments(patch) {
    set((get) => ({
      state: {
        ...get.state,
        adjustments: patchAdjustments(get.state.adjustments, patch),
      },
    }))
  },

  setHslBand(band, patch) {
    set((get) => ({
      state: {
        ...get.state,
        hsl: {
          ...get.state.hsl,
          [band]: { ...get.state.hsl[band], ...patch },
        },
      },
    }))
  },

  setHsl(hsl) {
    set((get) => ({ state: { ...get.state, hsl } }))
  },

  setCurves(curves) {
    set((get) => ({ state: { ...get.state, curves } }))
  },

  setToneMap(mode) {
    set((get) => ({ state: { ...get.state, adjustments: { ...get.state.adjustments, tonemap: mode } } }))
  },

  /* ------------------------------------------------------------------ */

  setLut(patch) {
    set((get) => ({ state: { ...get.state, lut: { ...get.state.lut, ...patch } } }))
  },

  clearLut() {
    set((get) => ({ state: { ...get.state, lut: defaultLut() } }))
  },

  /* ------------------------------------------------------------------ */

  addLayer(kind = 'adjustment') {
    const { state, commit } = get()
    const layer = defaultMaskLayer(state.layers.length)
    layer.kind = kind
    commit()
    set({
      state: { ...state, layers: [...state.layers, layer] },
      activeLayerId: layer.id,
      tool: kind === 'erase' ? 'eraser' : 'brush',
    })
    return layer.id
  },

  removeLayer(id) {
    const { state, commit } = get()
    const layers = state.layers.filter((layer) => layer.id !== id)
    commit()
    set({
      state: { ...state, layers },
      activeLayerId: get().activeLayerId === id ? (layers.at(-1)?.id ?? null) : get().activeLayerId,
    })
  },

  duplicateLayer(id) {
    const { state, commit } = get()
    const index = state.layers.findIndex((layer) => layer.id === id)
    const source = state.layers[index]
    if (!source) return
    const copy: MaskLayer = {
      ...structuredClone(source),
      id: `layer_${Date.now().toString(36)}_${state.layers.length}`,
      name: `${source.name} (copie)`,
      createdAt: Date.now(),
    }
    const layers = [...state.layers]
    layers.splice(index + 1, 0, copy)
    commit()
    set({ state: { ...state, layers }, activeLayerId: copy.id })
  },

  selectLayer(id) {
    set({ activeLayerId: id })
  },

  updateLayer(id, patch) {
    set((get) => ({
      state: {
        ...get.state,
        layers: get.state.layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)),
      },
    }))
  },

  updateLayerAdjustments(id, patch) {
    set((get) => ({
      state: {
        ...get.state,
        layers: get.state.layers.map((layer) =>
          layer.id === id
            ? { ...layer, adjustments: patchAdjustments(layer.adjustments, patch) }
            : layer,
        ),
      },
    }))
  },

  updateBrush(id, patch) {
    set((get) => ({
      state: {
        ...get.state,
        layers: get.state.layers.map((layer) =>
          layer.id === id ? { ...layer, brush: { ...layer.brush, ...patch } } : layer,
        ),
      },
    }))
  },

  reorderLayer(id, direction) {
    set((get) => {
      const layers = [...get.state.layers]
      const index = layers.findIndex((layer) => layer.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= layers.length) return {}
      const [moved] = layers.splice(index, 1)
      layers.splice(target, 0, moved!)
      return { state: { ...get.state, layers } }
    })
  },

  /* ------------------------------------------------------------------ */

  setTool(tool) {
    set({ tool })
  },

  setPanel(activePanel) {
    set({ activePanel })
  },

  setView(patch) {
    set((get) => ({ view: { ...get.view, ...patch } }))
  },

  toggleCompare() {
    set((get) => ({
      view: { ...get.view, split: get.view.split >= 0 ? -1 : 0.5 },
    }))
  },

  /* ------------------------------------------------------------------ */

  commit() {
    const { state, past } = get()
    if (past.length >= HISTORY_LIMIT) return
    set({ past: [...past, structuredClone(state)], future: [] })
  },

  undo() {
    const { past, future, state } = get()
    const previous = past.at(-1)
    if (!previous) return
    set({
      state: previous,
      past: past.slice(0, -1),
      future: [...future, structuredClone(state)],
    })
  },

  redo() {
    const { past, future, state } = get()
    const next = future.at(-1)
    if (!next) return
    set({
      state: next,
      past: [...past, structuredClone(state)],
      future: future.slice(0, -1),
    })
  },

  reset() {
    const { commit } = get()
    commit()
    set({ state: defaultEditorState(), activeLayerId: null })
  },

  /**
   * Remplace l'état courant — c'est le point d'entrée des presets.
   * Un JSON invalide ou d'une version inconnue est toléré : `parseEditorState`
   * migre ce qu'il peut et comble le reste.
   */
  replace(next, options = {}) {
    const { history = true } = options
    if (history) get().commit()
    const state: EditorState = typeof next === 'object' && 'version' in (next as object)
      ? parseEditorState(next)
      : { ...defaultEditorState(), adjustments: defaultAdjustments(), hsl: defaultHsl(), curves: defaultCurves() }
    set({ state, activeLayerId: state.layers.at(-1)?.id ?? null })
  },
}))

/* ==========================================================================
 * Sélecteurs — évite de se réabonner à tout le store.
 * ========================================================================== */

/** Calque en cours d'édition, ou `null`. */
export function useActiveLayer(): MaskLayer | null {
  return useEditorStore((s) => {
    if (!s.activeLayerId) return null
    return s.state.layers.find((layer) => layer.id === s.activeLayerId) ?? null
  })
}

/** Le calque reçoit-il les réglages globaux plutôt que les siens ? */
export function useTargetsLayer(): boolean {
  return useEditorStore((s) => s.activeLayerId !== null)
}

/** Nombre de réglages non neutres — affiché sur le bouton « réinitialiser ». */
export function useDirtyCount(): number {
  return useEditorStore((s) => {
    let count = 0
    for (const [key, value] of Object.entries(s.state.adjustments)) {
      if (key === 'tonemap') {
        if (value !== 'none') count += 1
        continue
      }
      if (value !== 0) count += 1
    }
    if (s.state.lut.id) count += 1
    if (s.state.layers.length > 0) count += s.state.layers.length
    return count
  })
}

export const BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'luminosity',
  'color',
  'hue',
]
