/**
 * Courbes de tonalité.
 *
 * Quatre courbes (maîtresse + R, G, B) sont compositées en UNE texture
 * 256 × 1 : le shader fait un seul `texture()` et récupère les trois canaux
 * corrigés. C'est 256 octets de mise à jour au lieu d'une évaluation de
 * spline par pixel.
 *
 * L'interpolation est un polynôme cubique MONOTONE (Fritsch–Carlson) : c'est
 * le choix de Photoshop et Lightroom, et surtout le seul qui ne crée pas de
 * dépassement entre deux points — un rebond se verrait immédiatement comme
 * une image « gondolée » dans les basses lumières.
 */

import type { Curves, CurvesPoints } from '@/types/editor'

const LUT_SIZE = 256

/** Précalcule les coefficients du segment actif pour chaque abscisse. */
type SplineTable = {
  xs: number[]
  ys: number[]
  /** Pente à chaque point. */
  ms: number[]
}

function prepare(points: CurvesPoints): SplineTable {
  const sorted = [...points].sort((a, b) => a.x - b.x)

  // Courbe dégénérée (moins de 2 points) -> identité.
  if (sorted.length < 2) {
    return { xs: [0, 255], ys: [0, 255], ms: [1, 1] }
  }

  // On insère les extrémités manquantes : une courbe est toujours évaluée
  // sur l'intervalle complet [0, 255].
  if (sorted[0]!.x > 0) sorted.unshift({ x: 0, y: 0 })
  if (sorted[sorted.length - 1]!.x < 255) sorted.push({ x: 255, y: 255 })

  const xs = sorted.map((p) => p.x)
  const ys = sorted.map((p) => p.y)
  const n = xs.length

  // Pentes initiales : secants, puis tangentes de Hermite.
  const delta: number[] = []
  for (let i = 0; i < n - 1; i += 1) {
    const h = (xs[i + 1]! - xs[i]!) || 1
    delta.push((ys[i + 1]! - ys[i]!) / h)
  }

  const ms: number[] = new Array(n)
  ms[0] = delta[0]!
  ms[n - 1] = delta[n - 2]!
  for (let i = 1; i < n - 1; i += 1) {
    if (delta[i - 1]! * delta[i]! <= 0) {
      ms[i] = 0 // extremum local : tangente horizontale, pas de dépassement
    } else {
      const h0 = xs[i]! - xs[i - 1]!
      const h1 = xs[i + 1]! - xs[i]!
      const w0 = 2 * h1 + h0
      const w1 = h1 + 2 * h0
      ms[i] = (w0 + w1) / (w0 / delta[i - 1]! + w1 / delta[i]!)
    }
  }

  return { xs, ys, ms }
}

function evaluate(table: SplineTable, x: number): number {
  const { xs, ys, ms } = table
  const n = xs.length

  if (x <= xs[0]!) return ys[0]!
  if (x >= xs[n - 1]!) return ys[n - 1]!

  // Recherche dichotomique du segment.
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid]! <= x) lo = mid
    else hi = mid
  }

  const h = xs[lo + 1]! - xs[lo]!
  const t = h > 0 ? (x - xs[lo]!) / h : 0
  const t2 = t * t
  const t3 = t2 * t

  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2

  return h00 * ys[lo]! + h10 * h * ms[lo]! + h01 * ys[lo + 1]! + h11 * h * ms[lo + 1]!
}

/**
 * Composit les quatre courbes en un buffer RGBA de 256 texels.
 *
 * Ordre d'application, identique à Lightroom :
 *   canal → courbe du canal → courbe maîtresse
 */
export function buildCurveLut(curves: Curves): Uint8Array {
  const master = prepare(curves.rgb)
  const red = prepare(curves.red)
  const green = prepare(curves.green)
  const blue = prepare(curves.blue)

  const out = new Uint8Array(LUT_SIZE * 4)

  for (let i = 0; i < LUT_SIZE; i += 1) {
    const r = clamp255(evaluate(master, clamp255(evaluate(red, i))))
    const g = clamp255(evaluate(master, clamp255(evaluate(green, i))))
    const b = clamp255(evaluate(master, clamp255(evaluate(blue, i))))

    out[i * 4 + 0] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = 255
  }

  return out
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

/** Crée (ou met à jour) la texture 256×1 des courbes. */
export class CurveTexture {
  readonly texture: WebGLTexture

  private constructor(private readonly gl: WebGL2RenderingContext) {
    const texture = gl.createTexture()
    if (!texture) throw new Error('Impossible de créer la texture des courbes')

    gl.bindTexture(gl.TEXTURE_2D, texture)
    // NEAREST : on veut le point de table exact, pas une interpolation.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)

    this.texture = texture
  }

  static create(gl: WebGL2RenderingContext, curves: Curves): CurveTexture {
    const instance = new CurveTexture(gl)
    instance.update(curves)
    return instance
  }

  update(curves: Curves): void {
    const { gl } = this
    const data = buildCurveLut(curves)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture)
  }
}
