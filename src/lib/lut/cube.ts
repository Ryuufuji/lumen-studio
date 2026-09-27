/**
 * Lecture des LUTs.
 *
 * Deux formats sont acceptés :
 *  - `.cube`  (Adobe/Iridas) : table 3D textuelle, 17³ à 65³.
 *  - Hald CLUT `.png` : une image dont chaque pixel est un point de la table.
 *
 * Les deux sont convertis vers le MÊME format interne : un `Float32Array` de
 * 4 composantes par entrée, indexé rouge-le-plus-rapide, que le GPU reçoit
 * en `RGBA16F`.
 */

export const MIN_LUT_SIZE = 2
export const MAX_LUT_SIZE = 65

export interface ParsedLut {
  /** Nom lu dans l'en-tête, ou le nom de fichier. */
  title: string
  size: number
  /** size³ × 4, normalisé [0,1], RGBA où A = 1. */
  data: Float32Array
  format: 'cube' | 'hald'
  /** Message d'avertissement non bloquant (ordre de parcours déduit…). */
  warning?: string
}

export class LutParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LutParseError'
  }
}

const LINE_COMMENT = /^\s*#/
const TITLE = /^\s*TITLE\s+"?(.*?)"?\s*$/i
const LUT_3D_SIZE = /^\s*LUT_3D_SIZE\s+(\d+)\s*$/i
const LUT_1D_SIZE = /^\s*LUT_1D_SIZE\s+(\d+)\s*$/i
const DOMAIN_MIN = /^\s*DOMAIN_MIN\s+(\S+)\s+(\S+)\s+(\S+)\s*$/i
const DOMAIN_MAX = /^\s*DOMAIN_MAX\s+(\S+)\s+(\S+)\s+(\S+)\s*$/i
const TRIPLE = /^\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/

/* ==========================================================================
 * .cube
 * ========================================================================== */

export function parseCube(text: string, fallbackTitle = 'LUT importée'): ParsedLut {
  const lines = text.split(/\r?\n/)

  let title = fallbackTitle
  let size = 0
  let domainMin = [0, 0, 0] as [number, number, number]
  let domainMax = [1, 1, 1] as [number, number, number]
  const entries: number[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!
    if (LINE_COMMENT.test(raw)) continue

    const titleMatch = TITLE.exec(raw)
    if (titleMatch) {
      title = titleMatch[1]?.trim() || title
      continue
    }

    const sizeMatch = LUT_3D_SIZE.exec(raw)
    if (sizeMatch) {
      size = Number(sizeMatch[1])
      continue
    }

    // Une LUT 1D n'est pas gérable telle quelle par un sampler3D : on la
    // refuse explicitement plutôt que d'afficher un rendu faux en silence.
    if (LUT_1D_SIZE.test(raw)) {
      throw new LutParseError(
        'LUT 1D non supportée : convertissez-la en LUT 3D (Adobe LUT Builder, ' +
          'ou DaVinci Resolve > Color > LUTs).',
      )
    }

    const minMatch = DOMAIN_MIN.exec(raw)
    if (minMatch) {
      domainMin = [Number(minMatch[1]), Number(minMatch[2]), Number(minMatch[3])]
      continue
    }

    const maxMatch = DOMAIN_MAX.exec(raw)
    if (maxMatch) {
      domainMax = [Number(maxMatch[1]), Number(maxMatch[2]), Number(maxMatch[3])]
      continue
    }

    const triple = TRIPLE.exec(raw)
    if (triple) {
      entries.push(Number(triple[1]), Number(triple[2]), Number(triple[3]))
    }
  }

  if (size === 0) throw new LutParseError('LUT_3D_SIZE manquant : ce fichier n\'est pas une .cube valide')
  if (size < MIN_LUT_SIZE || size > MAX_LUT_SIZE) {
    throw new LutParseError(`LUT_3D_SIZE = ${size} hors bornes (${MIN_LUT_SIZE}–${MAX_LUT_SIZE})`)
  }

  const expected = size * size * size * 3
  if (entries.length < expected) {
    throw new LutParseError(
      `Table incomplète : ${entries.length / 3} points pour ${size}³ = ${size ** 3} attendus.`,
    )
  }

  const data = new Float32Array(size * size * size * 4)
  const span = [
    domainMax[0] - domainMin[0] || 1,
    domainMax[1] - domainMin[1] || 1,
    domainMax[2] - domainMin[2] || 1,
  ]

  for (let i = 0; i < size ** 3; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      // Remap du domaine declared vers [0,1]. Les .cube mal formees
      // declarent souvent 0..1 alors que les valeurs sont en 0..255.
      let v = entries[i * 3 + c]!
      v = (v - domainMin[c]!) / span[c]!
      if (v > 1 && v <= 255) v /= 255
      data[i * 4 + c] = Math.min(1, Math.max(0, v))
    }
    data[i * 4 + 3] = 1
  }

  const warning = entries.length > expected ? 'Données supplémentaires ignorées' : undefined
  return { title, size, data, format: 'cube', warning }
}

/* ==========================================================================
 * Hald CLUT
 * ========================================================================== */

/**
 * Layout officiel d'une Hald CLUT de niveau `level` :
 * image de `(8·level)²` pixels de large sur `8·level` de haut.
 *   b = y · g = ⌊x / size⌋ · r = x mod size
 */
export function haldSize(level: number): number {
  return level * 8
}

export function parseHald(
  pixels: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  level: number,
  title = 'Hald CLUT',
): ParsedLut {
  const size = haldSize(level)
  const expectedWidth = size * size

  if (imageWidth !== expectedWidth || imageHeight !== size) {
    throw new LutParseError(
      `Hald de niveau ${level} : image ${imageWidth}×${imageHeight}, ` +
        `attendu ${expectedWidth}×${size}.`,
    )
  }

  const data = new Float32Array(size ** 3 * 4)

  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const x = g * size + r
        const p = (b * imageWidth + x) * 4
        const i = (b * size * size + g * size + r) * 4
        // Les Hald sont souvent packés en sRGB 8 bits : on convertit en
        // linéaire, sinon les ombres de la LUT sont beaucoup trop claires.
        data[i + 0] = srgb8ToLinear(pixels[p]! / 255)
        data[i + 1] = srgb8ToLinear(pixels[p + 1]! / 255)
        data[i + 2] = srgb8ToLinear(pixels[p + 2]! / 255)
        data[i + 3] = 1
      }
    }
  }

  return { title, size, data, format: 'hald' }
}

function srgb8ToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/* ==========================================================================
 * Float32 → Float16
 * ==========================================================================
 * Les textures `RGBA16F` sont filtrables nativement en WebGL2, alors que
 * `RGBA32F` exige `OES_texture_float_linear`. On encode donc en demi-précision
 * : 2× moins de bande passante, et la qualité est largement suffisante pour
 * une table de correspondance dont les entrées sont déjà quantifiées.
 * ========================================================================== */

const floatView = new Float32Array(1)
const intView = new Uint32Array(floatView.buffer)

export function toHalfFloat(value: number): number {
  floatView[0] = value
  const x = intView[0]!

  const sign = (x >>> 16) & 0x8000
  let mantissa = x & 0x007fffff
  const exponent = (x >>> 23) & 0xff

  // Non fini, ou trop petit pour un demi-float -> flushing
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0)

  let halfExponent = exponent - 127 + 15
  if (halfExponent >= 0x1f) return sign | 0x7c00 // overflow -> infini
  if (halfExponent <= 0) {
    if (halfExponent < -10) return sign // sous le pas minimal -> zéro
    mantissa |= 0x00800000
    const shift = 14 - halfExponent
    return sign | (mantissa >> shift)
  }

  // Arrondi au plus proche, ties-to-even.
  const round = mantissa & 0x1000
  mantissa >>= 13
  halfExponent = (exponent - 127 + 15) << 10
  return sign | halfExponent | mantissa | (round === 0x1000 ? 1 : 0)
}

/** Convertit un RGBA Float32Array en RGBA Uint16Array demi-précision. */
export function toHalfFloatArray(source: Float32Array): Uint16Array {
  const out = new Uint16Array(source.length)
  for (let i = 0; i < source.length; i += 1) out[i] = toHalfFloat(source[i]!)
  return out
}

/* ==========================================================================
 * Validation
 * ========================================================================== */

export interface LutHealth {
  ok: boolean
  issues: string[]
}

/**
 * Contrôle qualité d'une LUT. Les tables trop saturées ou « steppées » sont
 * la première cause de banding visible sur les dégradés.
 */
export function inspectLut(lut: ParsedLut): LutHealth {
  const issues: string[] = []
  const { data, size } = lut

  // Continuité : un saut de plus de 1/8 entre deux points voisins trahit
  // une table sous-échantillonnée ou une conversion ratée.
  let maxJump = 0
  let saturations = 0
  let samples = 0

  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size - 1; r += 1) {
        const i = (b * size * size + g * size + r) * 4
        for (let c = 0; c < 3; c += 1) {
          const d = Math.abs(data[i + c]! - data[i + 4 + c]!)
          if (d > maxJump) maxJump = d
          if (data[i + c]! <= 0.001 || data[i + c]! >= 0.999) saturations += 1
        }
        samples += 3
      }
    }
  }

  if (size < 17) issues.push(`Résolution faible (${size}³) : Banding possible sur les dégradés.`)
  if (maxJump > 0.2) issues.push('Discontinuité détectée : la table est probablement sous-échantillonnée.')
  if (saturations / samples > 0.25) {
    issues.push('Beaucoup de valeurs écrêtées : la LUT écrase les hautes lumières et les ombres.')
  }

  return { ok: issues.length === 0, issues }
}
