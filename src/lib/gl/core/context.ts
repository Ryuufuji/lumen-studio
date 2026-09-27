/**
 * Création et interrogation du contexte WebGL2.
 *
 * Le moteur travaille en espace linéaire avec des cibles de rendu flottantes.
 * Si le GPU ne sait pas rendre en `float`, on rétrograde proprement en RGBA8
 * plutôt que de planter : l'image a simplement moins de headroom dans les
 * ombres et les hautes lumières.
 */

export interface GLCapabilities {
  /** Cibles de rendu flottantes (RGBA16F) — la base du travail en haute précision. */
  colorBufferFloat: boolean
  /** Filtrage linéaire des textures flottantes (qualité du zoom). */
  floatLinear: boolean
  /** Filtres d'atténuation pour le vignetage multi-échantillons. */
  anisotropic: boolean
  maxTextureSize: number
  /** Résolution d'une texture 3D : 33³ par défaut, 64³ si le GPU suit. */
  max3DTextureSize: number
  renderer: string
}

export interface GLContext {
  gl: WebGL2RenderingContext
  caps: GLCapabilities
  /** Format interne des cibles de rendu intermédiaires. */
  workingFormat: number
  workingType: number
  /** true si l'on peut Stocker du HDR sans clipping. */
  hdr: boolean
}

export class WebGLUnsupportedError extends Error {
  constructor(detail: string) {
    super(
      `WebGL2 est indisponible dans ce navigateur (${detail}). ` +
        `L'éditeur nécessite WebGL2 pour le rendu non destructif.`,
    )
    this.name = 'WebGLUnsupportedError'
  }
}

export function createGLContext(canvas: HTMLCanvasElement): GLContext {
  const gl = canvas.getContext('webgl2', {
    // L'antialiasing est fait par supersampling manuel : on garde le contrôle.
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    desynchronized: true,
  })

  if (!gl) throw new WebGLUnsupportedError('getContext("webgl2") a renvoyé null')

  const colorBufferFloat = gl.getExtension('EXT_color_buffer_float') !== null
  const colorBufferHalfFloat = gl.getExtension('EXT_color_buffer_half_float') !== null
  const floatLinear = gl.getExtension('OES_texture_float_linear') !== null

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = debugInfo
    ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER))

  const caps: GLCapabilities = {
    colorBufferFloat,
    floatLinear,
    anisotropic: gl.getExtension('EXT_texture_filter_anisotropic') !== null,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    max3DTextureSize: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number,
    renderer,
  }

  // On travaille en half-float : Dynamic Range largement suffisant pour une
  // retouche, pour deux fois moins de bande passante que le full float.
  const hdr = colorBufferHalfFloat || colorBufferFloat

  return {
    gl,
    caps,
    workingFormat: hdr ? gl.RGBA16F : gl.RGBA8,
    workingType: hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
    hdr,
  }
}
