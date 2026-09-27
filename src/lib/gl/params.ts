/**
 * Table de correspondance entre l'état de l'éditeur et la texture de données
 * lue par les shaders (4 × 16 texels RGBA32F).
 *
 * Un `uniform` par réglage serait plus lisible… jusqu'au 17e : on dépasserait
 * vite la limite d'uniforms sur les mobiles, et le pilotage depuis
 * TypeScript deviendrait fastidieux. Une texture de 256 flottants se met à
 * jour en un seul `texSubImage2D` et tient dans le budget partout.
 *
 * Ne changez pas l'ordre des lignes sans mettre à jour `GLSL_PARAMS`.
 */

import { ADJUSTMENT_SPEC_BY_KEY } from '@/lib/editor/schema'
import type { AdjustableKey, BasicAdjustments, BlendMode, HslMap, MaskLayer } from '@/types/editor'

export const PARAMS_WIDTH = 4
export const PARAMS_HEIGHT = 16
export const PARAMS_LENGTH = PARAMS_WIDTH * PARAMS_HEIGHT * 4

/**
 * Index plat d'un composant dans la texture de données.
 *
 * La texture fait 4 texels de large sur 16 de haut, chaque texel portant 4
 * flottants : l'index de la composante `c` du texel `x` de la ligne `y` est
 * `y * 16 + x * 4 + c`. Les macros GLSL utilisent la notation
 * `texelFetch(uParams, ivec2(col, row), 0).rgba` : la correspondance doit
 * être EXACTE, sinon un réglage part dans le mauvaise emplacement et reste
 * muet.
 */
const slot = (row: number, col: number, component: number) =>
  row * PARAMS_WIDTH * 4 + col * 4 + component

export const PARAM_INDEX = {
  exposure: slot(0, 0, 0),
  contrast: slot(0, 1, 1),
  highlights: slot(0, 2, 2),
  shadows: slot(0, 3, 3),

  whites: slot(1, 0, 0),
  blacks: slot(1, 1, 1),
  brightness: slot(1, 2, 2),
  vignette: slot(1, 3, 3),

  saturation: slot(2, 0, 0),
  vibrance: slot(2, 1, 1),
  clarity: slot(2, 2, 2),
  grain: slot(2, 3, 3),

  sharpness: slot(3, 0, 0),
  texture: slot(3, 1, 1),
  dehaze: slot(3, 2, 2),
  tonemap: slot(3, 3, 3),

  lutIntensity: slot(4, 0, 0),
  bypass: slot(4, 1, 1),
  opacity: slot(4, 2, 2),
  density: slot(4, 3, 3),

  layerKind: slot(5, 0, 0),
  hueShift: slot(5, 1, 1),
  blendMode: slot(5, 2, 2),

  /** Bande HSL n : texel 0 de la ligne 8+n. */
  hslBand: (band: number) => slot(8 + band, 0, 0),
} as const

const TONEMAP_INDEX = { none: 0, reinhard: 1, filmic: 2, aces: 3 } as const

const BLEND_INDEX: Record<BlendMode, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  'soft-light': 4,
  luminosity: 5,
  color: 6,
  hue: 7,
}

const LAYER_KIND_INDEX: Record<MaskLayer['kind'], number> = {
  adjustment: 0,
  erase: 1,
  color: 2,
  gradient: 3,
}

/**
 * Recopie un jeu de réglages dans le tampon.
 *
 * Chaque valeur est ramenée dans [-1,1] par rapport à sa valeur PAR DÉFAUT,
 * et non par rapport au milieu de sa plage. C'est indispensable : la
 * netteté et le grain partent de 0 et vont jusqu'à 100, donc « neutre » doit
 * tomber sur 0 et non sur -1 — sinon un curseur au repos applique déjà un
 * flou de 50 %.
 */
export function writeAdjustments(target: Float32Array, adjustments: BasicAdjustments): void {
  const write = (key: AdjustableKey, index: number) => {
    const spec = ADJUSTMENT_SPEC_BY_KEY[key]
    const neutral = spec.default
    const span =
      Math.max(Math.abs(spec.max - neutral), Math.abs(neutral - spec.min)) || 1
    target[index] = (adjustments[key] - neutral) / span
  }

  write('exposure', PARAM_INDEX.exposure)
  write('contrast', PARAM_INDEX.contrast)
  write('highlights', PARAM_INDEX.highlights)
  write('shadows', PARAM_INDEX.shadows)
  write('whites', PARAM_INDEX.whites)
  write('blacks', PARAM_INDEX.blacks)
  write('brightness', PARAM_INDEX.brightness)
  write('vignette', PARAM_INDEX.vignette)
  write('saturation', PARAM_INDEX.saturation)
  write('vibrance', PARAM_INDEX.vibrance)
  write('clarity', PARAM_INDEX.clarity)
  write('grain', PARAM_INDEX.grain)
  write('sharpness', PARAM_INDEX.sharpness)
  write('texture', PARAM_INDEX.texture)
  write('dehaze', PARAM_INDEX.dehaze)

  target[PARAM_INDEX.tonemap] = TONEMAP_INDEX[adjustments.tonemap] ?? 0
}

/** Les 8 bandes HSL occupent les lignes 8 à 15, une par ligne. */
export function writeHsl(target: Float32Array, hsl: HslMap): void {
  const bands = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const
  for (let i = 0; i < bands.length; i += 1) {
    const band = hsl[bands[i]!]
    const base = PARAM_INDEX.hslBand(i)
    target[base + 0] = band.hue / 100
    target[base + 1] = band.saturation / 100
    target[base + 2] = band.luminance / 100
    target[base + 3] = 0
  }
}

type EditorHsl = HslMap

/** Réglages globaux : la passe develop + la passe couleur partagent le tampon. */
export function writeGlobalParams(
  target: Float32Array,
  options: {
    adjustments: BasicAdjustments
    hsl: EditorHsl
    lutIntensity: number
    bypass: boolean
  },
): void {
  target.fill(0)
  writeAdjustments(target, options.adjustments)
  writeHsl(target, options.hsl)
  target[PARAM_INDEX.lutIntensity] = options.lutIntensity
  target[PARAM_INDEX.bypass] = options.bypass ? 1 : 0
}

/** Réglages d'un calque de masque : occupation, densité, mode de fusion. */
export function writeLayerParams(
  target: Float32Array,
  options: {
    layer: MaskLayer
    adjustments: BasicAdjustments
    hsl: EditorHsl
  },
): void {
  const { layer } = options
  target.fill(0)
  writeAdjustments(target, options.adjustments)
  writeHsl(target, options.hsl)
  target[PARAM_INDEX.layerKind] = LAYER_KIND_INDEX[layer.kind] ?? 0
  target[PARAM_INDEX.blendMode] = BLEND_INDEX[layer.blendMode] ?? 0
  target[PARAM_INDEX.opacity] = layer.opacity
  target[PARAM_INDEX.density] = layer.density
  target[PARAM_INDEX.hueShift] = layer.kind === 'color' ? 0.5 : 0
}

/**
 * Gain RGB de la balance des blancs.
 *
 * Approximation additive volontairement simple : elle est prévisible, et
 * prévisible est la priorité quand on parle d'exposer une image. Un modèle
 * Planckien complet est proposé plus bas via `whiteBalanceFromKelvin`.
 */
export function whiteBalanceGain(temperature: number, tint: number): [number, number, number] {
  const t = temperature / 100
  const g = tint / 100

  return [
    1 + 0.32 * t + 0.1 * g,
    1 - 0.04 * t - 0.26 * g,
    1 - 0.34 * t + 0.16 * g,
  ]
}

/**
 * Variante physique, pour l'inspecteur : température de couleur en Kelvin
 * ↔ temperature RGB relative. Base : illuminant D65 à 6504 K.
 */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = kelvin / 100
  let r: number
  let g: number
  let b: number

  if (t <= 66) {
    r = 255
    g = 99.4708025861 * Math.log(t) - 161.1195681661
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592)
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  }

  if (t >= 66) b = 255
  else if (t <= 19) b = 0
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307

  return [r / 255, g / 255, b / 255]
}

/** Bornes affichées dans l'inspecteur, dérivées de la table des réglages. */
export const ADJUSTMENT_LIMITS = {
  exposure: ADJUSTMENT_SPEC_BY_KEY.exposure,
  temperature: ADJUSTMENT_SPEC_BY_KEY.temperature,
} as const
