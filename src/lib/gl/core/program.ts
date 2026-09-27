/**
 * Compilation et cache des programmes GLSL.
 *
 * Un shader qui échoue doit échouer avec un message lisible : on remonte le
 * journal du pilote annoté, pas un `INVALID_OPERATION` opaque.
 */

export class ShaderCompileError extends Error {
  constructor(
    public readonly shaderType: 'vertex' | 'fragment',
    public readonly log: string,
  ) {
    super(`Échec de compilation du shader ${shaderType} :\n${log}`)
    this.name = 'ShaderCompileError'
  }
}

function annotate(source: string, log: string): string {
  const lines = source.split('\n')
  const seen = new Set<string>()
  const context: string[] = []

  for (const match of log.matchAll(/(?:ERROR|WARNING):\s*\d+:(\d+)/g)) {
    const line = Number(match[1])
    if (Number.isNaN(line) || seen.has(String(line))) continue
    seen.add(String(line))
    for (let i = Math.max(0, line - 3); i < Math.min(lines.length, line + 2); i += 1) {
      context.push(`${String(i + 1).padStart(4, ' ')} | ${lines[i] ?? ''}`)
    }
    context.push('     | ' + '-'.repeat(40))
  }

  return context.length > 0 ? `${log}\n\n${context.join('\n')}` : log
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Impossible de créer le shader')

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'journal indisponible'
    gl.deleteShader(shader)
    throw new ShaderCompileError(
      type === gl.VERTEX_SHADER ? 'vertex' : 'fragment',
      annotate(source, log),
    )
  }

  return shader
}

export class Program {
  readonly handle: WebGLProgram
  private readonly locations = new Map<string, WebGLUniformLocation | null>()

  constructor(
    private readonly gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
    readonly label: string,
  ) {
    const vs = compile(gl, gl.VERTEX_SHADER, vertexSource)
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)

    const program = gl.createProgram()
    if (!program) throw new Error('Impossible de créer le programme')

    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.bindAttribLocation(program, 0, 'aPosition')
    gl.linkProgram(program)

    // Les shaders sont libérés immédiatement : le programme lié les référence.
    gl.deleteShader(vs)
    gl.deleteShader(fs)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? 'journal indisponible'
      gl.deleteProgram(program)
      throw new Error(`Échec de l'édition de liens (${label}) :\n${log}`)
    }

    this.handle = program
  }

  use(): this {
    this.gl.useProgram(this.handle)
    return this
  }

  private location(name: string) {
    let loc = this.locations.get(name)
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(this.handle, name)
      this.locations.set(name, loc)
    }
    return loc
  }

  /** Uniform scalaire. No-op silencieux si l'uniform a été optimisé hors. */
  f(name: string, value: number): this {
    const loc = this.location(name)
    if (loc) this.gl.uniform1f(loc, value)
    return this
  }

  i(name: string, value: number): this {
    const loc = this.location(name)
    if (loc) this.gl.uniform1i(loc, value)
    return this
  }

  v2(name: string, x: number, y: number): this {
    const loc = this.location(name)
    if (loc) this.gl.uniform2f(loc, x, y)
    return this
  }

  v3(name: string, x: number, y: number, z: number): this {
    const loc = this.location(name)
    if (loc) this.gl.uniform3f(loc, x, y, z)
    return this
  }

  v4(name: string, x: number, y: number, z: number, w: number): this {
    const loc = this.location(name)
    if (loc) this.gl.uniform4f(loc, x, y, z, w)
    return this
  }

  /**
   * Lie une texture à l'unite `unit`.
   * `target` vaut TEXTURE_2D par defaut.
   */
  tex(name: string, unit: number, texture: WebGLTexture, target = 0): this {
    const loc = this.location(name)
    if (!loc) return this
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(target || gl.TEXTURE_2D, texture)
    gl.uniform1i(loc, unit)
    return this
  }

  /** Lie une texture 3D (LUT) à l'unité `unit`. */
  tex3d(name: string, unit: number, texture: WebGLTexture): this {
    const loc = this.location(name)
    if (!loc) return this
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_3D, texture)
    gl.uniform1i(loc, unit)
    return this
  }

  dispose(): void {
    this.gl.deleteProgram(this.handle)
  }
}
