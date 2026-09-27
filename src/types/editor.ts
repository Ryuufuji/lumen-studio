/**
 * ===========================================================================
 * MODÈLE DE DONNÉES DE L'ÉDITEUR
 * ===========================================================================
 *
 * Règle d'or : `EditorState` est 100 % sérialisable en JSON. C'est exactement
 * ce qui est stocké dans `presets.settings` et `projects.settings`, et ce qui
 * permet de rejouer une retouche à l'identique sur une autre photo.
 *
 * Conséquences de conception :
 *  - AUCUNE donnée binaire ici. Les masques peints vivent dans des textures
 *    GPU identifiées par `maskTextureId`, pas dans le JSON.
 *  - AUCUNE référence à un objet Three/Fabric. On stocke des nombres.
 *  - Les précision sont en `float` : l'objectif annoncé est le réglage fin.
 *    Les arrondi à l'affichage sont fait par les composants, pas ici.
 */

/** Version du schéma. Incrémentez à chaque changement de structure et
 *  ajoutez une migration dans `src/lib/editor/schema.ts`. */
export const EDITOR_STATE_VERSION = 1

/* -------------------------------------------------------------------------
 * Réglages de base — l'équivalent des panneaux Lightroom
 * ---------------------------------------------------------------------- */

/**
 * Chaque réglage déclare son étendue. Le moteur WebGL lit ces bornes pour
 * normaliser en [0,1] avant d'appliquer le shader, donc ces contraintes
 * sont partagées entre l'UI et le GPU.
 */
/** Réglages numériques (exclut `tonemap`, qui est un mode et non un curseur). */
export type AdjustableKey = Exclude<keyof BasicAdjustments, 'tonemap'>

export interface AdjustmentSpec {
  key: AdjustableKey
  label: string
  min: number
  max: number
  default: number
  /** Pas du clic de souris sur le rail. */
  step: number
  /** Nombre de décimales affichées. */
  precision: number
  /** L'unité est préfixée dans l'UI : « EV », « K », « % ». */
  unit?: string
}

export interface BasicAdjustments {
  // --- Lumière ---
  exposure: number //      -5 .. +5   (IL)
  contrast: number //      -100 .. +100
  highlights: number //    -100 .. +100
  shadows: number //       -100 .. +100
  whites: number //        -100 .. +100
  blacks: number //        -100 .. +100
  brightness: number //    -100 .. +100

  // --- Couleur ---
  temperature: number //   -100 .. +100 (échelle Relative Color Temperature)
  tint: number //          -100 .. +100 (vert ↔ magenta)
  vibrance: number //      -100 .. +100
  saturation: number //    -100 .. +100

  // --- Détails / effets ---
  texture: number //       -100 .. +100 (micro-contraste, plus fin que « clarté »)
  clarity: number //       -100 .. +100
  dehaze: number //        -100 .. +100
  sharpness: number //     0 .. 100
  grain: number //         0 .. 100
  vignette: number //      -100 .. +100

  // --- Tone mapping global ---
  tonemap: ToneMapMode
}

export type ToneMapMode = 'none' | 'reinhard' | 'filmic' | 'aces'

/** Canaux HSL réglables individuellement (8 bandes comme Lightroom). */
export const HSL_BANDS = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
] as const

export type HslBand = (typeof HSL_BANDS)[number]

export interface HslAdjustment {
  hue: number // -100 .. +100 (rotation autour de la teinte de référence)
  saturation: number // -100 .. +100
  luminance: number // -100 .. +100
}

export type HslMap = Record<HslBand, HslAdjustment>

/* -------------------------------------------------------------------------
 * Courbes
 * ---------------------------------------------------------------------- */

export interface CurvesPoint {
  x: number // 0..255
  y: number // 0..255
}

/** Une courbe est une liste de points triés par x, obtenue par lissage
 *  monotone (Fritsch–Carlson) au moment du tracé. */
export type CurvesPoints = CurvesPoint[]

export interface Curves {
  rgb: CurvesPoints
  red: CurvesPoints
  green: CurvesPoints
  blue: CurvesPoints
}

/* -------------------------------------------------------------------------
 * LUT
 * ---------------------------------------------------------------------- */

export interface LutReference {
  /** null = aucune LUT appliquée. */
  id: string | null
  slug: string | null
  name: string | null
  /** 0..1 — mélange entre l'original et le résultat de la LUT. */
  intensity: number
  format: 'cube' | 'hald' | 'identity'
  /**
   * URL de la texture 3D déjà uploadée, ou du fichier .cube.
   * Résolu une fois au chargement, jamais recalculé par le renderer.
   */
  sourceUrl: string | null
  /**
   * Clé de la texture GPU en cache.
   * Permet de ne ré-upload que si la LUT change réellement.
   */
  textureKey: string | null
}

/* -------------------------------------------------------------------------
 * Calques de masque — le « calque » façon Photoshop
 * ---------------------------------------------------------------------- */

export type LayerKind =
  | 'adjustment' // retouche localisée (exposition, contraste, netteté…)
  | 'erase' // masque de suppression / exclusion
  | 'gradient' // dégradé linéaire ou radial
  | 'color' // teinte localisée

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'luminosity'
  | 'color'
  | 'hue'

export interface BrushSettings {
  /** Diamètre en pixels de l'espace image (indépendant du zoom). */
  size: number
  /** 0 = entièrement doux, 1 = bord dur. */
  hardness: number
  /** Opacité par application successive du pinceau. */
  flow: number
  /** Distance entre deux dalles de pinceau, en % du diamètre. */
  spacing: number
  /** 0 = on ne peint que du blanc (révéler), 1 = on efface. */
  erase: boolean
}

export interface MaskLayer {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  /** Opacité d'effet du calque, indépendante de l'opacité du pinceau. */
  opacity: number
  blendMode: BlendMode
  brush: BrushSettings

  /** Adoucissement du bord du masque, en pixels image. */
  feather: number
  /** Inversion du masque (noir ↔ blanc). */
  inverted: boolean

  /**
   * Clé de la texture de masque dans le cache GPU.
   * C'est ici que vit la peinture — jamais dans le JSON.
   * En production, sérialisé en PNG dans le bucket pour l'autosave.
   */
  maskTextureKey: string | null

  /** Densité du masque (l'alpha) appliquée par la LUT du calque. */
  density: number

  /** Retouches propres à ce calque, appliquées AVANT le masque. */
  adjustments: BasicAdjustments
  /** Ajout de saturation/vertice réservé aux calques de type `color`. */
  hls?: HslMap

  createdAt: number
}

/* -------------------------------------------------------------------------
 * Recadrage
 * ---------------------------------------------------------------------- */

export interface CropState {
  /** Rectangle en coordonnées image normalisées [0,1]. */
  x: number
  y: number
  width: number
  height: number
  angle: number // degrés
}

/* -------------------------------------------------------------------------
 * Historique (undo/redo) — sérialisable, on ne stocke que des deltas
 * ---------------------------------------------------------------------- */

export interface HistoryEntry {
  label: string
  state: EditorState
  at: number
}

/* -------------------------------------------------------------------------
 * État complet
 * ---------------------------------------------------------------------- */

export interface EditorState {
  version: number

  adjustments: BasicAdjustments
  hsl: HslMap
  curves: Curves

  lut: LutReference

  /** Pile de calques de masque, du fond (index 0) vers l'avant. */
  layers: MaskLayer[]

  crop: CropState | null

  /** Comparaison avant/après : 0 = original, 1 = retouché. */
  beforeAfter: number
  /** Bypass global de toutes les retouches (raccourci \). */
  bypass: boolean
}

export type EditorTool =
  | 'select'
  | 'brush'
  | 'eraser'
  | 'gradient'
  | 'radial'
  | 'crop'
  | 'zoom'
  | 'pan'
  | 'eyedropper'
  | 'compare'

export type PanelId = 'light' | 'color' | 'details' | 'curves' | 'effects' | 'masks' | 'luts'
