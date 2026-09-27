/**
 * Chargement de l'image source et des textures de données.
 *
 * L'image est stockée en `SRGB8_ALPHA8` : c'est le GPU, et non le shader,
 * qui décode le sRGB vers le linéaire au moment du prélèvement. On économise
 * ainsi une pow() par pixel ET on évite toute dérive entre le CPU et le GPU.
 */

export interface SourceImage {
  texture: WebGLTexture
  width: number
  height: number
  /** EXIF minimal, lu avant le décodage GPU. */
  orientation: number
}

export async function loadImageBitmap(file: File | Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // Certains Safari refusent les blobs sans type MIME : on retente en
      // passant par une URL d'objet, puis on laisse tomber proprement.
      const url = URL.createObjectURL(file)
      try {
        const response = await fetch(url)
        return await createImageBitmap(await response.blob())
      } finally {
        URL.revokeObjectURL(url)
      }
    }
  }
  throw new Error('createImageBitmap est requis pour décoder les images.')
}

export function createSourceTexture(
  gl: WebGL2RenderingContext,
  bitmap: ImageBitmap,
): SourceImage {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Impossible de créer la texture source')

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)

  gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.generateMipmap(gl.TEXTURE_2D)

  applyAnisotropy(gl, texture)

  gl.bindTexture(gl.TEXTURE_2D, null)

  return {
    texture,
    width: bitmap.width,
    height: bitmap.height,
    orientation: 1,
  }
}

function applyAnisotropy(gl: WebGL2RenderingContext, texture: WebGLTexture): void {
  const extension = gl.getExtension('EXT_texture_filter_anisotropic')
  if (!extension) return
  const max = gl.getParameter(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number
  gl.texParameterf(gl.TEXTURE_2D, extension.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max))
}

/**
 * Texture de paramètres : 4 × 16 texels RGBA32F, filtrage NEAREST puisque
 * l'accès se fait par `texelFetch`. C'est elle qui porte tous les réglages.
 */
export function createParamsTexture(gl: WebGL2RenderingContext, data: Float32Array): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Impossible de créer la texture de paramètres')

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, 16, 0, gl.RGBA, gl.FLOAT, data)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return texture
}

export function updateParamsTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  data: Float32Array,
): void {
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, 16, gl.RGBA, gl.FLOAT, data)
  gl.bindTexture(gl.TEXTURE_2D, null)
}

/** Texture blanche 1×1 : évite les branches nulles dans les shaders. */
export function createWhiteTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Impossible de créer la texture blanche')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]))
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.bindTexture(gl.TEXTURE_2D, null)
  return texture
}

/**
 * Cube identité 1×1×1, utilisé quand aucune LUT n'est appliquée.
 *
 * INDISPENSABLE, et pas un simple confort : un `sampler3D` dont l'unité de
 * texture est liée à une texture 2D provoque un INVALID_OPERATION qui fait
 * ÉCHOUER l'appel de dessin entier. Sans ce cube de secours, la passe LUT
 * saute et tout ce qu'elle reliait en aval est perdu — un bug
 * extremement deroutant, car les passes en amont « marchent » et celles
 * d'apres ne sont jamais executees.
 */
export function createIdentityLutTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Impossible de créer la texture LUT identité')
  gl.bindTexture(gl.TEXTURE_3D, texture)
  gl.texImage3D(
    gl.TEXTURE_3D,
    0,
    gl.RGBA16F,
    1,
    1,
    1,
    0,
    gl.RGBA,
    gl.HALF_FLOAT,
    new Uint16Array([0, 0, 0, 0x3c00]), // (0, 0, 0, 1) en demi-précision
  )
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
  gl.bindTexture(gl.TEXTURE_3D, null)
  return texture
}
