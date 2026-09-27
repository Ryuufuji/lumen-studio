/**
 * Orchestrateur du pipeline de rendu.
 *
 * Schéma des passes, dans l'ordre :
 *
 *   source (sRGB, décodée en linéaire par le GPU)
 *     ├─ 1 develop  ── exposition, blanc, brume, tone mapping   [linéaire]
 *     ├─ 2 detail   ── texture, clarté, netteté                  [linéaire]
 *     ├─ 3 color    ── courbes, HSL, vibrance, plage de tons    [→ perceptuel]
 *     │   └─ copie → `under` (le « dessous » des calques)
 *     ├─ 4 layer    ── un passage par calque visible             [perceptuel]
 *     ├─ 5 lut      ── table 3D mixée par intensité             [perceptuel]
 *     └─ 6 fx       ── vignetage, grain, encodage sRGB          [→ affichage]
 *                          │
 *                          ▼
 *                     7 present ── zoom, panoramique, comparateur
 *
 * Chaque étape lit une cible et en écrit une autre : le ping-pong garantit
 * qu'aucun fragment ne lit ce qu'il écrit.
 */

import { createGLContext, type GLContext } from './core/context'
import { Program } from './core/program'
import { FULLSCREEN_VERTEX_SHADER, FullscreenQuad, PingPong, RenderTarget } from './core/render-target'
import {
  COLOR_FRAGMENT,
  DEVELOP_FRAGMENT,
  DETAIL_FRAGMENT,
  FX_FRAGMENT,
  LAYER_FRAGMENT,
  LUT_FRAGMENT,
  PRESENT_FRAGMENT,
} from './shaders/pipeline'
import { COPY_FRAGMENT, MASK_VIEW_FRAGMENT } from './shaders/mask'
import { CurveTexture } from './curve-texture'
import { MaskRegistry, type GpuMask } from './mask'
import { LutLibrary } from '@/lib/lut/library'
import {
  PARAMS_HEIGHT,
  PARAMS_LENGTH,
  PARAMS_WIDTH,
  whiteBalanceGain,
  writeGlobalParams,
  writeLayerParams,
} from './params'
import { createIdentityLutTexture, createParamsTexture, createSourceTexture, createWhiteTexture, updateParamsTexture } from './texture'
import type { BrushSettings, EditorState, MaskLayer } from '@/types/editor'
import { defaultCurves } from '@/lib/editor/schema'

export interface ViewState {
  /** Zoom relatif à l'ajustement. 1 = l'image tient dans le canvas. */
  zoom: number
  /** Panoramique, en fraction du canvas. */
  offsetX: number
  offsetY: number
  /** Position du comparateur, en fraction du canvas. < 0 = désactivé. */
  split: number
  /** Affiche le masque du calque actif en niveaux de gris. */
  showMask: boolean
}

export const DEFAULT_VIEW: ViewState = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  split: -1,
  showMask: false,
}

export class Renderer {
  readonly context: GLContext
  private readonly gl: WebGL2RenderingContext
  private readonly quad: FullscreenQuad
  private readonly registry: MaskRegistry
  private readonly luts: LutLibrary

  private readonly programs: {
    develop: Program
    detail: Program
    color: Program
    layer: Program
    lut: Program
    fx: Program
    present: Program
    copy: Program
    maskView: Program
  }

  private readonly globalParams: WebGLTexture
  private readonly layerParams: WebGLTexture
  private readonly white: WebGLTexture
  /** Cube 1×1×1 identité : garantit qu'un sampler3D est toujours lié. */
  private readonly identityLut: WebGLTexture
  private readonly globalBuffer = new Float32Array(PARAMS_LENGTH)
  private readonly layerBuffer = new Float32Array(PARAMS_LENGTH)

  private curves: CurveTexture
  private pingPong!: PingPong
  private under!: RenderTarget
  private output!: RenderTarget

  private source: { texture: WebGLTexture; width: number; height: number } | null = null
  private originalSize: [number, number] = [0, 0]

  private frame = 0
  private disposed = false

  /** Renseigné quand la passe LUT tourne sans texture liée. */
  private activeLut: { texture: WebGLTexture; size: number } | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.context = createGLContext(canvas)
    this.gl = this.context.gl
    this.quad = new FullscreenQuad(this.gl)
    this.registry = new MaskRegistry(this.gl, this.quad)
    this.luts = new LutLibrary(this.gl)

    const make = (label: string, fragment: string) =>
      new Program(this.gl, FULLSCREEN_VERTEX_SHADER, fragment, label)

    this.programs = {
      develop: make('develop', DEVELOP_FRAGMENT),
      detail: make('detail', DETAIL_FRAGMENT),
      color: make('color', COLOR_FRAGMENT),
      layer: make('layer', LAYER_FRAGMENT),
      lut: make('lut', LUT_FRAGMENT),
      fx: make('fx', FX_FRAGMENT),
      present: make('present', PRESENT_FRAGMENT),
      copy: make('copy', COPY_FRAGMENT),
      maskView: make('mask-view', MASK_VIEW_FRAGMENT),
    }

    this.globalParams = createParamsTexture(this.gl, this.globalBuffer)
    this.layerParams = createParamsTexture(this.gl, this.layerBuffer)
    this.white = createWhiteTexture(this.gl)
    this.identityLut = createIdentityLutTexture(this.gl)
    this.curves = CurveTexture.create(this.gl, defaultCurves())

    const { gl } = this
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  }

  /* ---------------------------------------------------------------------
   * Source
   * ------------------------------------------------------------------ */

  get size(): [number, number] {
    return this.originalSize
  }

  get hasImage(): boolean {
    return this.source !== null
  }

  async setImage(bitmap: ImageBitmap): Promise<void> {
    const { gl } = this
    this.releaseSource()

    const image = createSourceTexture(gl, bitmap)
    this.source = { texture: image.texture, width: image.width, height: image.height }
    this.originalSize = [image.width, image.height]

    this.allocateTargets(image.width, image.height)
    this.registry.clear()
  }

  private releaseSource(): void {
    if (this.source) {
      this.gl.deleteTexture(this.source.texture)
      this.source = null
      this.originalSize = [0, 0]
    }
  }

  private allocateTargets(width: number, height: number): void {
    const { gl, context } = this

    if (this.pingPong) {
      this.pingPong.resize(width, height)
      this.under.resize(width, height)
      this.output.resize(width, height)
      return
    }

    this.pingPong = new PingPong(gl, width, height, context.workingFormat, context.workingType)
    this.under = new RenderTarget(gl, width, height, context.workingFormat, context.workingType)
    this.output = new RenderTarget(gl, width, height, gl.RGBA8, gl.UNSIGNED_BYTE)
  }

  /* ---------------------------------------------------------------------
   * LUT
   * ------------------------------------------------------------------ */

  /** Lie une texture de LUT au pipeline. `null` retire la LUT. */
  setLut(lut: { texture: WebGLTexture; size: number } | null): void {
    this.activeLut = lut
  }

  get lutCache(): LutLibrary {
    return this.luts
  }

  /* ---------------------------------------------------------------------
   * Rendu
   * ------------------------------------------------------------------ */

  render(state: EditorState, view: ViewState, canvasWidth: number, canvasHeight: number): void {
    if (this.disposed) return
    const { gl } = this
    this.frame += 1

    if (!this.source) {
      this.presentEmpty(view, canvasWidth, canvasHeight)
      return
    }

    const masks = this.registry.sync(state.layers, this.source.width, this.source.height)
    const activeMask = this.activeMask(masks, state)

    // 0. Paramètres
    this.curves.update(state.curves)
    writeGlobalParams(this.globalBuffer, {
      adjustments: state.adjustments,
      hsl: state.hsl,
      lutIntensity: state.lut.intensity,
      bypass: state.bypass,
    })
    updateParamsTexture(gl, this.globalParams, this.globalBuffer)

    // 1. Develop
    this.pingPong.write.bind()
    const [gr, gg, gb] = whiteBalanceGain(
      state.adjustments.temperature,
      state.adjustments.tint,
    )
    this.programs.develop
      .use()
      .tex('uSource', 0, this.source.texture)
      .tex('uParams', 1, this.globalParams)
      .v2('uTexel', 1 / this.source.width, 1 / this.source.height)
      .v3('uWhiteGain', gr, gg, gb)
    this.quad.draw()
    this.pingPong.swap()

    // 2. Detail
    this.pingPong.write.bind()
    this.programs.detail
      .use()
      .tex('uSource', 0, this.pingPong.read.texture)
      .tex('uParams', 1, this.globalParams)
      .v2('uTexel', 1 / this.source.width, 1 / this.source.height)
    this.quad.draw()
    this.pingPong.swap()

    // 3. Couleur — c'est le « dessous » des calques de masque.
    this.pingPong.write.bind()
    this.programs.color
      .use()
      .tex('uSource', 0, this.pingPong.read.texture)
      .tex('uParams', 1, this.globalParams)
      .tex('uCurve', 2, this.curves.texture)
    this.quad.draw()
    this.pingPong.swap()

    this.blit(this.pingPong.read, this.under)

    // 4. Calques de masque
    for (const layer of state.layers) {
      if (!layer.visible || layer.opacity <= 0) continue
      const mask = masks.get(layer.id)
      if (!mask) continue

      const maskTexture = mask.getFeathered(layer.feather)
      writeLayerParams(this.layerBuffer, {
        layer,
        adjustments: layer.adjustments,
        hsl: state.hsl,
      })
      updateParamsTexture(gl, this.layerParams, this.layerBuffer)

      this.pingPong.write.bind()
      this.programs.layer
        .use()
        .tex('uSource', 0, this.pingPong.read.texture)
        .tex('uUnder', 1, this.under.texture)
        .tex('uMask', 2, maskTexture)
        .tex('uParams', 3, this.layerParams)
        .tex('uCurve', 4, this.curves.texture)
        .f('uInverted', layer.inverted ? 1 : 0)
      this.quad.draw()
      this.pingPong.swap()
    }

    // 5. LUT
    this.pingPong.write.bind()
    const lutProgram = this.programs.lut
      .use()
      .tex('uSource', 0, this.pingPong.read.texture)
      .tex('uParams', 1, this.globalParams)
      .i('uLutSize', this.activeLut?.size ?? 33)
      .f('uLutEnabled', this.activeLut ? 1 : 0)
    // Toujours lier un sampler3D valide, même sans LUT : sinon l'unité
    // reste sur la texture 2D de uSource et le dessin est rejeté.
    lutProgram.tex3d('uLut', 2, this.activeLut?.texture ?? this.identityLut)
    this.quad.draw()
    this.pingPong.swap()

    // 6. Effets → cible d'export sRGB
    this.output.bind()
    this.programs.fx
      .use()
      .tex('uSource', 0, this.pingPong.read.texture)
      .tex('uParams', 1, this.globalParams)
      .v2('uResolution', this.source.width, this.source.height)
      .f('uFrame', this.frame)
    this.quad.draw()

    // 7. Présentation
    this.present(state, view, canvasWidth, canvasHeight, activeMask)
  }

  private activeMask(masks: Map<string, GpuMask>, state: EditorState): WebGLTexture {
    for (let i = state.layers.length - 1; i >= 0; i -= 1) {
      const layer = state.layers[i]!
      if (layer.visible) return masks.get(layer.id)?.texture ?? this.white
    }
    return this.white
  }

  private presentEmpty(view: ViewState, width: number, height: number): void {
    const { gl } = this
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    this.programs.present
      .use()
      .tex('uImage', 0, this.white)
      .tex('uOriginal', 1, this.white)
      .tex('uMaskPreview', 2, this.white)
      .f('uHasImage', 0)
      .f('uBypass', 0)
      .f('uSplit', view.split)
      .f('uShowMask', 0)
      .v2('uViewScale', 1, 1)
      .v2('uViewOffset', 0, 0)
    this.quad.draw()
  }

  private present(
    state: EditorState,
    view: ViewState,
    width: number,
    height: number,
    activeMask: WebGLTexture,
  ): void {
    const { gl } = this
    const imageWidth = this.source?.width ?? 1
    const imageHeight = this.source?.height ?? 1

    // Taille affichée, en pixels puis en fraction de canvas.
    const fit = Math.min(width / imageWidth, height / imageHeight)
    const displayWidth = imageWidth * fit * view.zoom
    const displayHeight = imageHeight * fit * view.zoom

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)

    this.programs.present
      .use()
      .tex('uImage', 0, this.output.texture)
      .tex('uOriginal', 1, this.source!.texture)
      .tex('uMaskPreview', 2, activeMask)
      .f('uHasImage', 1)
      .f('uBypass', state.bypass ? 1 : 0)
      .f('uSplit', view.split)
      .f('uShowMask', view.showMask ? 1 : 0)
      .v2('uViewScale', displayWidth / width, displayHeight / height)
      .v2('uViewOffset', view.offsetX, view.offsetY)
    this.quad.draw()
  }

  /** Rendu du masque seul, pour la superposition d'édition. */
  renderMaskPreview(mask: GpuMask, inverted: boolean): void {
    const { gl } = this
    this.output.bind()
    this.programs.maskView.use().tex('uMask', 0, mask.texture).f('uInverted', inverted ? 1 : 0)
    this.quad.draw()
  }

  private blit(from: RenderTarget, to: RenderTarget): void {
    const { gl } = this
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from.framebuffer)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to.framebuffer)
    gl.blitFramebuffer(
      0, 0, from.width, from.height,
      0, 0, to.width, to.height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    )
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
  }

  /* ---------------------------------------------------------------------
   * Pinceau
   * ------------------------------------------------------------------ */

  /**
   * Peint un segment. Les coordonnées sont en pixels image : l'appelant fait
   * la conversion écran → image, le moteur ne connaît pas le zoom.
   */
  paintStroke(
    layer: MaskLayer,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    pressure = 1,
  ): void {
    const mask = this.registry.get(layer, this.source?.width ?? 1, this.source?.height ?? 1)
    const brush: BrushSettings = { ...layer.brush, erase: layer.brush.erase }
    mask.stroke(fromX, fromY, toX, toY, brush, pressure)
  }

  getMask(layer: MaskLayer): GpuMask | null {
    if (!this.source) return null
    return this.registry.get(layer, this.source.width, this.source.height)
  }

  removeMask(layerId: string): void {
    this.registry.remove(layerId)
  }

  clearMask(layer: MaskLayer): void {
    this.getMask(layer)?.clear()
  }

  /* ---------------------------------------------------------------------
   * Export
   * ------------------------------------------------------------------ */

  /**
   * Exporte l'image retouchée en pleine résolution.
   *
   * Le résultat vient de la passe « effets » : il est déjà encodé sRGB et
   * déjà dans le bon ordre de lignes. En effet, le triangle plein écran
   * place `vUv.y = 0` en bas du viewport, et `v = 0` dans la texture source
   * correspond à la première ligne de l'image (c'est-à-dire son HAUT) :
   * les deux inversions se compensent, et `readPixels` rend donc l'image
   * à l'endroit. Ne surtout pas retourner les lignes ici.
   */
  async exportBlob(type = 'image/jpeg', quality = 0.95): Promise<Blob> {
    if (!this.source) throw new Error('Aucune image chargée.')
    const { width, height } = this.source

    const pixels = new Uint8ClampedArray(width * height * 4)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.output.framebuffer)
    this.gl.readPixels(0, 0, width, height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D indisponible pour l\'export.')
    context.putImageData(new ImageData(pixels, width, height), 0, 0)

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Échec de l\'encodage.'))),
        type,
        quality,
      )
    })
  }

  /* ---------------------------------------------------------------------
   * Cycle de vie
   * ------------------------------------------------------------------ */

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    for (const program of Object.values(this.programs)) program.dispose()
    this.quad.dispose()
    this.registry.clear()
    this.luts.dispose()
    this.curves.dispose()

    this.pingPong?.dispose()
    this.under?.dispose()
    this.output?.dispose()

    const { gl } = this
    gl.deleteTexture(this.globalParams)
    gl.deleteTexture(this.layerParams)
    gl.deleteTexture(this.white)
    gl.deleteTexture(this.identityLut)
    this.releaseSource()
  }
}

/** Rectangle d'affichage, utilisé par la surcouche React (poignées, guides). */
export function viewRect(
  view: ViewState,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; width: number; height: number } {
  const fit = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight)
  const width = imageWidth * fit * view.zoom
  const height = imageHeight * fit * view.zoom
  return {
    x: (canvasWidth - width) / 2 + view.offsetX * canvasWidth,
    y: (canvasHeight - height) / 2 + view.offsetY * canvasHeight,
    width,
    height,
  }
}

export { PARAMS_WIDTH, PARAMS_HEIGHT }
