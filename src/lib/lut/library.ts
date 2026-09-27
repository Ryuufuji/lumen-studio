/**
 * Cache et upload des LUTs vers le GPU.
 *
 * Une texture 3D 33³ RGBA16F pèse 574 Ko. On en garde quelques-unes en
 * mémoire (LUT active + ses voisines de la galerie) et on libère le reste.
 */

import { LutParseError, haldSize, parseCube, parseHald, toHalfFloatArray, type ParsedLut } from './cube'

export interface GpuLut {
  texture: WebGLTexture
  size: number
  title: string
  bytes: number
}

export class LutLibrary {
  private readonly cache = new Map<string, GpuLut>()
  private readonly pending = new Map<string, Promise<GpuLut>>()

  /** Touches actuellement montées, pour ne pas évincer ce qu'on regarde. */
  private readonly pinned = new Set<string>()

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly maxEntries = 6,
  ) {}

  /**
   * Récupère (ou construit) la texture d'une LUT.
   * `key` est le `textureKey` de l'état de l'éditeur.
   */
  async acquire(key: string, source: LutSource): Promise<GpuLut> {
    const cached = this.cache.get(key)
    if (cached) {
      this.pinned.add(key)
      this.evict()
      return cached
    }

    const inflight = this.pending.get(key)
    if (inflight) return inflight

    const promise = this.build(key, source)
      .then((lut) => {
        this.cache.set(key, lut)
        this.pending.delete(key)
        this.pinned.add(key)
        this.evict()
        return lut
      })
      .catch((error: unknown) => {
        this.pending.delete(key)
        throw error
      })

    this.pending.set(key, promise)
    return promise
  }

  /** Marque une LUT comme non instantly affichable pour libérer sa place. */
  release(key: string): void {
    this.pinned.delete(key)
    this.evict()
  }

  has(key: string): boolean {
    return this.cache.has(key)
  }

  private evict(): void {
    if (this.cache.size <= this.maxEntries) return
    for (const [key, lut] of this.cache) {
      if (this.cache.size <= this.maxEntries) break
      if (this.pinned.has(key)) continue
      this.gl.deleteTexture(lut.texture)
      this.cache.delete(key)
    }
  }

  private async build(key: string, source: LutSource): Promise<GpuLut> {
    const parsed = await loadLut(source)
    return this.upload(key, parsed)
  }

  private upload(key: string, parsed: ParsedLut): GpuLut {
    const { gl } = this
    const texture = gl.createTexture()
    if (!texture) throw new LutParseError('Impossible de créer la texture de LUT (GPU saturé ?)')

    gl.bindTexture(gl.TEXTURE_3D, texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

    const half = toHalfFloatArray(parsed.data)
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGBA16F,
      parsed.size,
      parsed.size,
      parsed.size,
      0,
      gl.RGBA,
      gl.HALF_FLOAT,
      half,
    )

    // LINEAR sur les trois axes = interpolation trilineaire, ce qui est
    // exactement ce qu'on veut entre deux points de la table.
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)

    // La table ne bouge jamais une fois uploaded : on fixe le niveau de
    // détail pour que le pilote n'en génère pas par erreur.
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_BASE_LEVEL, 0)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAX_LEVEL, parsed.size - 1)

    gl.bindTexture(gl.TEXTURE_3D, null)

    return {
      texture,
      size: parsed.size,
      title: parsed.title,
      bytes: half.byteLength,
    }
  }

  dispose(): void {
    for (const lut of this.cache.values()) this.gl.deleteTexture(lut.texture)
    this.cache.clear()
    this.pending.clear()
    this.pinned.clear()
  }
}

/* ==========================================================================
 * Sources de LUT
 * ========================================================================== */

export type LutSource =
  | { kind: 'text'; text: string; title?: string }
  | { kind: 'hald'; pixels: Uint8ClampedArray; width: number; height: number; level: number; title?: string }
  | { kind: 'url'; url: string; title?: string; level?: number }

/** Devine le format à partir du nom de fichier, en dernier recours. */
function guessLevel(name: string): number {
  const match = /hald[._-]?clut[._-]?(\d+)/i.exec(name)
  const level = match ? Number(match[1]) : 2
  // Niveaux valides : 2 (16³), 4 (32³), 8 (64³).
  return haldSize(level) >= 2 ? level : 2
}

export async function loadLut(source: LutSource): Promise<ParsedLut> {
  if (source.kind === 'text') {
    return parseCube(source.text, source.title ?? 'LUT importée')
  }

  if (source.kind === 'hald') {
    return parseHald(source.pixels, source.width, source.height, source.level, source.title)
  }

  const response = await fetch(source.url)
  if (!response.ok) {
    throw new LutParseError(`Téléchargement impossible (${response.status}) : ${source.url}`)
  }

  const blob = await response.blob()
  const name = source.title ?? source.url.split('/').pop() ?? 'lut'

  if (name.toLowerCase().endsWith('.png') || blob.type === 'image/png') {
    const level = source.level ?? guessLevel(name)
    const bitmap = await createImageBitmap(blob)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new LutParseError('Canvas 2D indisponible : impossible de lire la Hald.')
      context.drawImage(bitmap, 0, 0)
      const image = context.getImageData(0, 0, bitmap.width, bitmap.height)
      return parseHald(image.data, image.width, image.height, level, name)
    } finally {
      bitmap.close()
    }
  }

  return parseCube(await blob.text(), name)
}

/** Lecture d'un fichier choisi par l'utilisateur, `.cube` ou `.png`. */
export async function lutSourceFromFile(file: File): Promise<LutSource> {
  const isPng = file.name.toLowerCase().endsWith('.png') || file.type === 'image/png'
  if (!isPng) {
    return { kind: 'text', text: await file.text(), title: file.name.replace(/\.cube$/i, '') }
  }
  const bitmap = await createImageBitmap(file)
  const level = guessLevel(file.name)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new LutParseError('Canvas 2D indisponible.')
  context.drawImage(bitmap, 0, 0)
  const image = context.getImageData(0, 0, bitmap.width, bitmap.height)
  bitmap.close()
  return {
    kind: 'hald',
    pixels: image.data,
    width: image.width,
    height: image.height,
    level,
    title: file.name.replace(/\.png$/i, ''),
  }
}
