import type { GLContext } from './context'

/**
 * Quad plein écran.
 *
 * On utilise deux triangles débordants plutôt qu'un quad indexé : pas de
 * buffer d'indices, pas de diagonal à gérer, un seul `drawArrays` pour tout
 * le pipeline.
 */
export const FULLSCREEN_VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 aPosition;
out vec2 vUv;

void main() {
  // aPosition couvre [-1, 3] : un seul triangle couvre tout l'ecran.
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

export class FullscreenQuad {
  private readonly vao: WebGLVertexArrayObject

  constructor(private readonly gl: WebGL2RenderingContext) {
    const vao = gl.createVertexArray()
    if (!vao) throw new Error('Impossible de créer le VAO')
    this.vao = vao

    gl.bindVertexArray(vao)

    const buffer = gl.createBuffer()
    if (!buffer) throw new Error('Impossible de créer le buffer')
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    )

    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    gl.bindVertexArray(null)
  }

  draw(): void {
    const { gl } = this
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao)
  }
}

/**
 * Cible de rendu = une texture + un framebuffer.
 *
 * Toutes les passes intermédiaires du pipeline écrivent dans une `RenderTarget`.
 * Rien n'est lu et écrit en même temps : c'est la garantie qu'un shader ne
 * peut pas s'auto-alimenter.
 */
export class RenderTarget {
  readonly texture: WebGLTexture
  readonly framebuffer: WebGLFramebuffer

  constructor(
    private readonly gl: WebGL2RenderingContext,
    public width: number,
    public height: number,
    private readonly internalFormat: number,
    private readonly type: number,
    filter: number = gl.LINEAR,
  ) {
    const texture = gl.createTexture()
    const framebuffer = gl.createFramebuffer()
    if (!texture || !framebuffer) throw new Error('Impossible de créer la cible de rendu')

    this.texture = texture
    this.framebuffer = framebuffer

    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, type, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    // CLAMP_TO_EDGE : indispensable, sinon l'echantillonnage du voisin deborde
    // sur l'autre extremite de l'image (effet de couture au bord du cadre).
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(
        `Cible de rendu incomplète (0x${status.toString(16)}) — ` +
          `format interne 0x${internalFormat.toString(16)} refusé par le GPU.`,
      )
    }
  }

  bind(): void {
    const { gl } = this
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.viewport(0, 0, this.width, this.height)
  }

  clear(r = 0, g = 0, b = 0, a = 1): void {
    const { gl } = this
    gl.clearColor(r, g, b, a)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /** Réalloue si les dimensions ont changé. Pas de recréation inutile. */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return
    const { gl } = this
    this.width = width
    this.height = height
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, this.internalFormat, width, height, 0, gl.RGBA, this.type, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture)
    this.gl.deleteFramebuffer(this.framebuffer)
  }
}

/** Paire de cibles interverties : évite tout alias lecture/écriture. */
export class PingPong {
  private index = 0

  constructor(
    private readonly gl: WebGL2RenderingContext,
    width: number,
    height: number,
    internalFormat: number,
    type: number,
  ) {
    this.a = new RenderTarget(gl, width, height, internalFormat, type)
    this.b = new RenderTarget(gl, width, height, internalFormat, type)
  }

  a: RenderTarget
  b: RenderTarget

  /** Cible sur laquelle écrire. */
  get write(): RenderTarget {
    return this.index === 0 ? this.b : this.a
  }

  /** Cible contenant le résultat précédent. */
  get read(): RenderTarget {
    return this.index === 0 ? this.a : this.b
  }

  swap(): void {
    this.index = 1 - this.index
  }

  resize(width: number, height: number): void {
    this.a.resize(width, height)
    this.b.resize(width, height)
  }

  dispose(): void {
    this.a.dispose()
    this.b.dispose()
  }
}

export function createTargets(
  context: GLContext,
  width: number,
  height: number,
): PingPong {
  return new PingPong(
    context.gl,
    width,
    height,
    context.workingFormat,
    context.workingType,
  )
}
