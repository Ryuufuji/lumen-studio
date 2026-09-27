/**
 * Un calque de masque côté GPU.
 *
 * Chaque calque possède :
 *  - un framebuffer `R8` de la taille de l'image, écrit directement au
 *    pinceau (aucune couche vectorielle, aucun rendu Canvas2D intermédiaire) ;
 *  - un framebuffer « adouci », produit par deux passes de Gaussienne
 *    séparable, utilisé par la passe de composition.
 *
 * Le masque n'est jamais écrasé par l'adoucissement : on filtre une copie.
 * Sans cela, augmenter puis baisser le feather détruirait progressivement la
 * peinture, ce qui est le bug le plus courant des implémentations de masques.
 */

import { FullscreenQuad, RenderTarget } from './core/render-target'
import { Program } from './core/program'
import { FULLSCREEN_VERTEX_SHADER } from './core/render-target'
import { BLUR_FRAGMENT, BRUSH_FRAGMENT } from './shaders/mask'
import type { BrushSettings, MaskLayer } from '@/types/editor'

const MAX_BLUR_TAPS = 16

export class GpuMask {
  /** Masque brut — ce que le pinceau écrit. */
  private readonly raw: RenderTarget
  /** Masque adouci — ce que la passe de composition lit. */
  private readonly soft: RenderTarget
  private readonly scratch: RenderTarget

  private readonly brushProgram: Program
  private readonly blurProgram: Program

  private featherCache = 0
  private dirty = true

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly quad: FullscreenQuad,
    public width: number,
    public height: number,
  ) {
    this.raw = new RenderTarget(gl, width, height, gl.R8, gl.UNSIGNED_BYTE, gl.LINEAR)
    this.soft = new RenderTarget(gl, width, height, gl.R8, gl.UNSIGNED_BYTE, gl.LINEAR)
    this.scratch = new RenderTarget(gl, width, height, gl.R8, gl.UNSIGNED_BYTE, gl.LINEAR)

    this.brushProgram = new Program(gl, FULLSCREEN_VERTEX_SHADER, BRUSH_FRAGMENT, 'brush')
    this.blurProgram = new Program(gl, FULLSCREEN_VERTEX_SHADER, BLUR_FRAGMENT, 'mask-blur')

    this.clear()
  }

  get texture(): WebGLTexture {
    return this.soft.texture
  }

  clear(): void {
    // 0 = zone non retouchée, 1 = zone entièrement retouchée.
    this.raw.clear(0, 0, 0, 1)
    this.soft.clear(0, 0, 0, 1)
    this.scratch.clear(0, 0, 0, 1)
    this.dirty = true
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    this.raw.resize(width, height)
    this.soft.resize(width, height)
    this.scratch.resize(width, height)
    this.clear()
  }

  /* ---------------------------------------------------------------------
   * Pinceau
   * ------------------------------------------------------------------ */

  /**
   * Peint une empreinte de pinceau unique.
   * Les coordonnées sont en pixels IMAGE, indépendantes du zoom.
   */
  stamp(
    centerX: number,
    centerY: number,
    radius: number,
    brush: BrushSettings,
  ): void {
    const { gl } = this
    const r = Math.max(radius, 0.5)

    // Une marge d'un texel évite que la fenêtre ne coupe l'empreinte.
    const pad = r + 2
    const minX = Math.max(0, Math.floor(centerX - pad))
    const maxX = Math.min(this.width, Math.ceil(centerX + pad))
    const minY = Math.max(0, Math.floor(centerY - pad))
    const maxY = Math.min(this.height, Math.ceil(centerY + pad))
    if (maxX <= minX || maxY <= minY) return

    const regionWidth = maxX - minX
    const regionHeight = maxY - minY

    this.raw.bind()
    gl.enable(gl.SCISSOR_TEST)
    gl.viewport(minX, minY, regionWidth, regionHeight)
    gl.scissor(minX, minY, regionWidth, regionHeight)

    // Mélange classique : le blanc (ou le noir) de l'empreinte recouvre le
    // fond à `flow` près. Les empilements convergent vers 1 sans l'atteindre
    // jamais d'un coup — c'est ce qui donne du fondu au pinceau.
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE)

    this.brushProgram
      .use()
      .v2('uRegionMin', minX, minY)
      .v2('uRegionSize', regionWidth, regionHeight)
      .v2('uCenter', centerX, centerY)
      .f('uRadius', r)
      .f('uHardness', brush.hardness)
      .f('uFlow', brush.flow)
      .v3('uColor', brush.erase ? 0 : 1, brush.erase ? 0 : 1, brush.erase ? 0 : 1)

    this.quad.draw()

    gl.disable(gl.BLEND)
    gl.disable(gl.SCISSOR_TEST)
    gl.viewport(0, 0, this.width, this.height)

    this.dirty = true
  }

  /**
   * Peint un segment entre deux points, en déposant les empreintes
   * intermédiaires à intervalles réguliers.
   *
   * C'est l'espacement (`spacing`) qui rend le trait régulier : sans lui, un
   * déplacement rapide de la souris laisserait des trous entre deux images.
   */
  stroke(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    brush: BrushSettings,
    pressureScale = 1,
  ): void {
    const distance = Math.hypot(toX - fromX, toY - fromY)
    const radius = Math.max(1, (brush.size * pressureScale) / 2)
    const step = Math.max(radius * brush.spacing, 0.75)

    if (distance <= step) {
      this.stamp((fromX + toX) / 2, (fromY + toY) / 2, radius, brush)
      return
    }

    const count = Math.min(Math.ceil(distance / step), 512)
    for (let i = 1; i <= count; i += 1) {
      const t = i / count
      this.stamp(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t, radius, brush)
    }
  }

  /* ---------------------------------------------------------------------
   * Adoucissement
   * ------------------------------------------------------------------ */

  /** Produit (si nécessaire) la version adoucie du masque. */
  getFeathered(feather: number): WebGLTexture {
    // En dessous d'un demi-texel, la gaussienne est identité : on l'évite.
    const sigma = Math.max(feather, 0)
    if (Math.abs(sigma - this.featherCache) < 0.25 && !this.dirty) {
      return this.soft.texture
    }

    if (sigma < 0.25) {
      // feather nul : copie brute, sans passer par la convolution.
      this.copyRawToSoft()
      this.featherCache = 0
      this.dirty = false
      return this.soft.texture
    }

    const taps = Math.min(MAX_BLUR_TAPS, Math.max(1, Math.ceil(sigma * 2.5)))
    const { gl } = this
    gl.disable(gl.BLEND)

    // Passe horizontale : brut → scratch
    this.scratch.bind()
    this.blurProgram
      .use()
      .tex('uSource', 0, this.raw.texture)
      .v2('uDirection', 1 / this.width, 0)
      .f('uRadius', sigma)
      .i('uSamples', taps)
    this.quad.draw()

    // Passe verticale : scratch → adouci
    this.soft.bind()
    this.blurProgram
      .use()
      .tex('uSource', 0, this.scratch.texture)
      .v2('uDirection', 0, 1 / this.height)
      .f('uRadius', sigma)
      .i('uSamples', taps)
    this.quad.draw()

    this.featherCache = sigma
    this.dirty = false

    return this.soft.texture
  }

  private copyRawToSoft(): void {
    const { gl } = this
    // R8 → R8 : un simple glBlitFramebuffer évite un shader de plus.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.raw.framebuffer)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.soft.framebuffer)
    gl.blitFramebuffer(
      0, 0, this.width, this.height,
      0, 0, this.width, this.height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    )
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
  }

  markDirty(): void {
    this.dirty = true
  }

  /* ---------------------------------------------------------------------
   * Persistance
   * ------------------------------------------------------------------ */

  /** Lecture du masque en niveaux de gris, pour l'aperçu et l'export. */
  readPixels(): Uint8Array {
    const { gl } = this
    const pixels = new Uint8Array(this.width * this.height * 4)

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.raw.framebuffer)
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    return pixels
  }

  /** Restaure un masque depuis des pixels RGBA (réhydratation d'un preset). */
  writePixels(pixels: Uint8Array): void {
    const { gl } = this
    gl.bindTexture(gl.TEXTURE_2D, this.raw.texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.width,
      this.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    )
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.dirty = true
  }

  dispose(): void {
    this.raw.dispose()
    this.soft.dispose()
    this.scratch.dispose()
    this.brushProgram.dispose()
    this.blurProgram.dispose()
  }
}

/** Table de correspondance calque logique → masque GPU. */
export class MaskRegistry {
  private readonly masks = new Map<string, GpuMask>()

  constructor(private readonly gl: WebGL2RenderingContext, private readonly quad: FullscreenQuad) {}

  get(layer: MaskLayer, width: number, height: number): GpuMask {
    let mask = this.masks.get(layer.id)
    if (!mask) {
      mask = new GpuMask(this.gl, this.quad, width, height)
      this.masks.set(layer.id, mask)
    } else {
      mask.resize(width, height)
    }
    return mask
  }

  remove(layerId: string): void {
    this.masks.get(layerId)?.dispose()
    this.masks.delete(layerId)
  }

  sync(layers: MaskLayer[], width: number, height: number): Map<string, GpuMask> {
    const alive = new Set(layers.map((layer) => layer.id))
    for (const id of [...this.masks.keys()]) {
      if (!alive.has(id)) this.remove(id)
    }
    const out = new Map<string, GpuMask>()
    for (const layer of layers) out.set(layer.id, this.get(layer, width, height))
    return out
  }

  clear(): void {
    for (const mask of this.masks.values()) mask.dispose()
    this.masks.clear()
  }
}
