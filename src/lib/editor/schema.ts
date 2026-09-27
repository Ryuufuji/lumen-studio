import { z } from 'zod'
import {
  EDITOR_STATE_VERSION,
  HSL_BANDS,
  type AdjustableKey,
  type AdjustmentSpec,
  type BasicAdjustments,
  type BrushSettings,
  type Curves,
  type EditorState,
  type HslBand,
  type HslMap,
  type LutReference,
  type MaskLayer,
} from '@/types/editor'

/* ==========================================================================
 * 1. Spécifications des réglages
 * ==========================================================================
 * Source de vérité unique pour les bornes. L'UI (rail du slider), le moteur
 * WebGL (normalisation vers [0,1]) et la validation Zod s'en servent tous.
 */

export const ADJUSTMENT_SPECS: readonly AdjustmentSpec[] = [
  // Lumière
  { key: 'exposure', label: 'Exposition', min: -5, max: 5, default: 0, step: 0.01, precision: 2, unit: 'IL' },
  { key: 'contrast', label: 'Contraste', min: -100, max: 100, default: 0, step: 0.5, precision: 1 },
  { key: 'highlights', label: 'Hautes lumières', min: -100, max: 100, default: 0, step: 0.5, precision: 1 },
  { key: 'shadows', label: 'Ombres', min: -100, max: 100, default: 0, step: 0.5, precision: 1 },
  { key: 'whites', label: 'Blancs', min: -100, max: 100, default: 0, step: 0.5, precision: 1 },
  { key: 'blacks', label: 'Noirs', min: -100, max: 100, default: 0, step: 0.5, precision: 1 },
  { key: 'brightness', label: 'Luminosité', min: -100, max: 100, default: 0, step: 0.5, precision: 1 },

  // Couleur
  { key: 'temperature', label: 'Température', min: -100, max: 100, default: 0, step: 0.5, precision: 1, unit: 'K' },
  { key: 'tint', label: 'Teinte', min: -100, max: 100, default: 0, step: 0.5, precision: 1 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, default: 0, step: 0.5, precision: 1 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, default: 0, step: 0.5, precision: 1 },

  // Détails & effets
  { key: 'texture', label: 'Texture', min: -100, max: 100, default: 0, step: 0.5, precision: 1 },
  { key: 'clarity', label: 'Clarté', min: -100, max: 100, default: 0, step: 0.5, precision: 1 },
  { key: 'dehaze', label: 'Désaturation', min: -100, max: 100, default: 0, step: 0.5, precision: 1 },
  { key: 'sharpness', label: 'Netteté', min: 0, max: 100, default: 0, step: 0.5, precision: 1 },
  { key: 'grain', label: 'Grain', min: 0, max: 100, default: 0, step: 0.5, precision: 1 },
  { key: 'vignette', label: 'Vignetage', min: -100, max: 100, default: 0, step: 0.5, precision: 1 },
] as const

export const ADJUSTMENT_SPEC_BY_KEY = Object.fromEntries(
  ADJUSTMENT_SPECS.map((spec) => [spec.key, spec]),
) as Record<AdjustableKey, AdjustmentSpec>

/* ==========================================================================
 * 2. Schéma Zod — validation des presets venus de la base ou d'un import
 * ==========================================================================
 * On est volontairement tolérant : un preset importé d'une version
 * antérieure ne doit pas casser l'application, il doit être migré.
 */

const num = z.number().finite()

/** Curseur borné : la borne vient de ADJUSTMENT_SPECS, jamais du double. */
const slider = (spec: AdjustmentSpec) => num.min(spec.min).max(spec.max).default(spec.default)

export const basicAdjustmentsSchema = z.object({
  // Lumière
  exposure: slider(ADJUSTMENT_SPEC_BY_KEY.exposure),
  contrast: slider(ADJUSTMENT_SPEC_BY_KEY.contrast),
  highlights: slider(ADJUSTMENT_SPEC_BY_KEY.highlights),
  shadows: slider(ADJUSTMENT_SPEC_BY_KEY.shadows),
  whites: slider(ADJUSTMENT_SPEC_BY_KEY.whites),
  blacks: slider(ADJUSTMENT_SPEC_BY_KEY.blacks),
  brightness: slider(ADJUSTMENT_SPEC_BY_KEY.brightness),

  // Couleur
  temperature: slider(ADJUSTMENT_SPEC_BY_KEY.temperature),
  tint: slider(ADJUSTMENT_SPEC_BY_KEY.tint),
  vibrance: slider(ADJUSTMENT_SPEC_BY_KEY.vibrance),
  saturation: slider(ADJUSTMENT_SPEC_BY_KEY.saturation),

  // Détails & effets
  texture: slider(ADJUSTMENT_SPEC_BY_KEY.texture),
  clarity: slider(ADJUSTMENT_SPEC_BY_KEY.clarity),
  dehaze: slider(ADJUSTMENT_SPEC_BY_KEY.dehaze),
  sharpness: slider(ADJUSTMENT_SPEC_BY_KEY.sharpness),
  grain: slider(ADJUSTMENT_SPEC_BY_KEY.grain),
  vignette: slider(ADJUSTMENT_SPEC_BY_KEY.vignette),

  // Tone mapping global
  tonemap: z.enum(['none', 'reinhard', 'filmic', 'aces']).default('none'),
}) satisfies z.ZodType<BasicAdjustments, z.ZodTypeDef, unknown>

const hslBandSchema = z
  .object({
    hue: num.min(-100).max(100).default(0),
    saturation: num.min(-100).max(100).default(0),
    luminance: num.min(-100).max(100).default(0),
  })
  .default({ hue: 0, saturation: 0, luminance: 0 })

const hslSchema = z
  .object({
    red: hslBandSchema,
    orange: hslBandSchema,
    yellow: hslBandSchema,
    green: hslBandSchema,
    aqua: hslBandSchema,
    blue: hslBandSchema,
    purple: hslBandSchema,
    magenta: hslBandSchema,
  })
  .default({
    red: { hue: 0, saturation: 0, luminance: 0 },
    orange: { hue: 0, saturation: 0, luminance: 0 },
    yellow: { hue: 0, saturation: 0, luminance: 0 },
    green: { hue: 0, saturation: 0, luminance: 0 },
    aqua: { hue: 0, saturation: 0, luminance: 0 },
    blue: { hue: 0, saturation: 0, luminance: 0 },
    purple: { hue: 0, saturation: 0, luminance: 0 },
    magenta: { hue: 0, saturation: 0, luminance: 0 },
  }) satisfies z.ZodType<HslMap, z.ZodTypeDef, unknown>

const curvePointSchema = z.object({ x: num.min(0).max(255), y: num.min(0).max(255) })

const curvesSchema = z.object({
  rgb: z.array(curvePointSchema),
  red: z.array(curvePointSchema),
  green: z.array(curvePointSchema),
  blue: z.array(curvePointSchema),
})

export const brushSettingsSchema = z.object({
  size: z.number().min(1).max(500).default(60),
  hardness: z.number().min(0).max(1).default(0.7),
  flow: z.number().min(0.01).max(1).default(0.6),
  spacing: z.number().min(0.01).max(2).default(0.12),
  erase: z.boolean().default(false),
})

export const maskLayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['adjustment', 'erase', 'gradient', 'color']).default('adjustment'),
  visible: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
  blendMode: z
    .enum(['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'luminosity', 'color', 'hue'])
    .default('normal'),
  brush: brushSettingsSchema,
  feather: z.number().min(0).max(500).default(0),
  inverted: z.boolean().default(false),
  maskTextureKey: z.string().nullable().default(null),
  density: z.number().min(0).max(1).default(1),
  adjustments: basicAdjustmentsSchema,
  hsl: hslSchema.optional(),
  createdAt: z.number().default(0),
})

const lutReferenceSchema = z.object({
  id: z.string().nullable().default(null),
  slug: z.string().nullable().default(null),
  name: z.string().nullable().default(null),
  intensity: z.number().min(0).max(1).default(1),
  format: z.enum(['cube', 'hald', 'identity']).default('identity'),
  sourceUrl: z.string().nullable().default(null),
  textureKey: z.string().nullable().default(null),
})

const cropSchema = z
  .object({
    x: num,
    y: num,
    width: num.positive(),
    height: num.positive(),
    angle: num,
  })
  .nullable()

export const editorStateSchema = z.object({
  version: z.number().int().default(EDITOR_STATE_VERSION),
  adjustments: basicAdjustmentsSchema,
  hsl: hslSchema,
  curves: curvesSchema,
  lut: lutReferenceSchema,
  layers: z.array(maskLayerSchema).default([]),
  crop: cropSchema.default(null),
  beforeAfter: z.number().min(0).max(1).default(1),
  bypass: z.boolean().default(false),
}) satisfies z.ZodType<EditorState, z.ZodTypeDef, unknown>

/* ==========================================================================
 * 3. Valeurs par défaut
 * ========================================================================== */

export function defaultAdjustments(): BasicAdjustments {
  const out = {} as BasicAdjustments
  for (const spec of ADJUSTMENT_SPECS) {
    out[spec.key] = spec.default
  }
  out.tonemap = 'none'
  return out
}

export function defaultHsl(): HslMap {
  return Object.fromEntries(
    HSL_BANDS.map((band) => [band, { hue: 0, saturation: 0, luminance: 0 }]),
  ) as HslMap
}

/** Courbe neutre : la diagonale. */
export function defaultCurves(): Curves {
  const diagonal = [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ]
  return { rgb: diagonal, red: diagonal, green: diagonal, blue: diagonal }
}

export function defaultLut(): LutReference {
  return {
    id: null,
    slug: null,
    name: null,
    intensity: 1,
    format: 'identity',
    sourceUrl: null,
    textureKey: null,
  }
}

export function defaultBrush(): BrushSettings {
  return { size: 60, hardness: 0.7, flow: 0.6, spacing: 0.12, erase: false }
}

export function defaultMaskLayer(index: number): MaskLayer {
  return {
    id: `layer_${Date.now().toString(36)}_${index}`,
    name: `Masque ${index + 1}`,
    kind: 'adjustment',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    brush: defaultBrush(),
    feather: 0,
    inverted: false,
    maskTextureKey: null,
    density: 1,
    adjustments: defaultAdjustments(),
    createdAt: Date.now(),
  }
}

export function defaultEditorState(): EditorState {
  return {
    version: EDITOR_STATE_VERSION,
    adjustments: defaultAdjustments(),
    hsl: defaultHsl(),
    curves: defaultCurves(),
    lut: defaultLut(),
    layers: [],
    crop: null,
    beforeAfter: 1,
    bypass: false,
  }
}

/* ==========================================================================
 * 4. Normalisation & migrations
 * ========================================================================== */

/**
 * Valide un JSON inconnu coming de la base ou d'un import.
 * Ne lève jamais : renvoie un état partiel mais toujours valide.
 */
export function parseEditorState(input: unknown): EditorState {
  const result = editorStateSchema.safeParse(input)
  if (result.success) return result.data

  // Zod a échoué : on tente une migration depuis une version plus ancienne,
  // puis on repars d'un état neutre en ne gardant que ce qui est récupérable.
  const migrated = migrateLegacy(input)
  const retry = editorStateSchema.safeParse(migrated)
  return retry.success ? retry.data : defaultEditorState()
}

/** Force une valeur dans les bornes de son réglage (protection du GPU). */
export function clampAdjustments(input: Partial<BasicAdjustments>): BasicAdjustments {
  const out = defaultAdjustments()
  for (const spec of ADJUSTMENT_SPECS) {
    const value = input[spec.key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[spec.key] = Math.min(spec.max, Math.max(spec.min, value))
    }
  }
  if (input.tonemap) out.tonemap = input.tonemap
  return out
}

/** Normalise un réglage vers [0,1] pour l'uniform GLSL. */
export function normalizeAdjustment(key: keyof BasicAdjustments, value: number): number {
  if (key === 'tonemap') return 0
  const spec = ADJUSTMENT_SPEC_BY_KEY[key]
  if (!spec) return 0
  return (value - spec.min) / (spec.max - spec.min)
}

/**
 * Migrations de schéma. Ajoutez une entrée par version.
 * v0 (bêta) : les réglages étaient stockés à plat, sans `layers`.
 */
function migrateLegacy(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input
  const record = input as Record<string, unknown>
  const version = typeof record.version === 'number' ? record.version : 0
  if (version >= EDITOR_STATE_VERSION) return record

  return {
    ...record,
    version: EDITOR_STATE_VERSION,
    layers: record.layers ?? [],
    curves: record.curves ?? defaultCurves(),
    hsl: record.hsl ?? defaultHsl(),
  }
}

/** Instantané sérialisable destiné à la colonne `jsonb`. */
export function serializeEditorState(state: EditorState): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>
}
