import { GLSL_BLEND, GLSL_COMMON, GLSL_PARAMS, GLSL_PERCEPTUAL_ADJUST } from './common'

/* ==========================================================================
 * PASSE 1 — DEVELOP (espace linéaire)
 * ==========================================================================
 * On ne peut pas raisonner sur « les ombres » ou « la clarté » en linéaire :
 * la perception y est écrasée. Cette passe ne traite donc que ce qui a un
 * sens physique — exposition, balance des blancs, brume, tone mapping.
 * ========================================================================== */

export const DEVELOP_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

${GLSL_COMMON}
${GLSL_PARAMS}

uniform sampler2D uSource;
uniform vec2 uTexel;      // 1 / dimensions image
uniform vec3 uWhiteGain;  // gain RGB de la balance des blancs

void main() {
  vec3 c = texture(uSource, vUv).rgb;

  // 1. Exposition, en diaphragmes. exp2 et non pow : une seule instruction.
  c *= exp2(P_EXPOSURE);

  // 2. Balance des blancs, appliquée en gain linéaire (approximation
  //    additive de la température, volontairement prévisible).
  c *= uWhiteGain;

  // 3. Désaturation atmosphérique. La lumière incidente est estimée par le
  //    maximum local : c'est l'approximation mono-image de Fattal, sans
  //    estimation de carte de transmission.
  float dehaze = P_DEHAZE;
  if (abs(dehaze) > 0.002) {
    vec3 blur = ringBlur(uSource, vUv, uTexel, 4.0);
    float a = max(max(blur.r, blur.g), blur.b);
    float t = clamp(1.0 - 0.85 * dehaze, 0.12, 1.6);
    c = max((c - a) / t + a, vec3(0.0));
  }

  // 4. Tone mapping : ramène le HDR dans [0,1] avant le passage perceptuel.
  c = applyTonemap(c, P_TONEMAP);

  fragColor = vec4(max(c, vec3(0.0)), 1.0);
}
`

/* ==========================================================================
 * PASSE 2 — DETAIL (espace linéaire, en entrée de la passe 1)
 * ==========================================================================
 * Passe séparée, et non un bloc `if` dans la passe 1 : un masque flou se
 * calcule sur ses VOISINS, donc sur l'image DÉJÀ développée. Mélanger les
 * deux dans un seul shader reviendrait à écraser l'exposition par le
 * voisinage.
 * ========================================================================== */

export const DETAIL_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

${GLSL_COMMON}
${GLSL_PARAMS}

uniform sampler2D uSource;
uniform vec2 uTexel;

void main() {
  vec3 c = texture(uSource, vUv).rgb;

  // Chaque passe repart de SON PROPRE uSource : sans cela, le résultat de
  // la première serait écrasé par la suivante et seul le dernier réglage
  // aurait un effet. Chaque accent relit donc l'image et l'on
  // cumule les deltas — c'est exactement ce que fait un empilement de
  // filtres Photoshop.
  c += unsharpDelta(uSource, vUv, uTexel, 1.2, P_TEXTURE * 0.25);
  c += unsharpDelta(uSource, vUv, uTexel, 6.0, P_CLARITY * 0.10);
  c += unsharpDelta(uSource, vUv, uTexel, 1.0, P_SHARPNESS * 0.5);

  fragColor = vec4(max(c, vec3(0.0)), 1.0);
}
`

/* ==========================================================================
 * PASSE 3 — COULEUR (linéaire → perceptuel)
 * ==========================================================================
 * Point de bascule du pipeline. Après cette passe, tout est en gamma 2.2 :
 * c'est l'espace dans lequel les courbes, le HSL et les LUTs ont été conçus.
 * ========================================================================== */

export const COLOR_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

${GLSL_COMMON}
${GLSL_PARAMS}
${GLSL_PERCEPTUAL_ADJUST}

uniform sampler2D uSource;

void main() {
  vec3 c = linearToPerceptual(texture(uSource, vUv).rgb);
  c = applyPerceptualAdjustments(c);
  fragColor = vec4(c, 1.0);
}
`

/* ==========================================================================
 * PASSE 4 — CALQUE DE MASQUE
 * ==========================================================================
 * kind : 0 retouche · 1 exclusion (révèle le dessous) · 2 teinte
 *
 * Le masque arrive déjà adouci par la passe de flou : ici on n'applique que
 * densité × opacité, plus l'inversion si elle est active.
 * ========================================================================== */

export const LAYER_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

${GLSL_COMMON}
${GLSL_PARAMS}
${GLSL_PERCEPTUAL_ADJUST}
${GLSL_BLEND}

uniform sampler2D uSource;  // composite courant
uniform sampler2D uUnder;   // résultat AVANT le premier calque
uniform sampler2D uMask;    // R8 feathered
uniform float uInverted;    // 0 ou 1

void main() {
  vec3 src = texture(uSource, vUv).rgb;

  if (P_BYPASS > 0.5) {
    fragColor = vec4(src, 1.0);
    return;
  }

  float m = texture(uMask, vUv).r;
  m = mix(m, 1.0 - m, uInverted);
  m = clamp(m * P_DENSITY * P_OPACITY, 0.0, 1.0);
  if (m < 0.0005) {
    fragColor = vec4(src, 1.0);
    return;
  }

  // Calque d'exclusion : on révèle la version d'avant les calques.
  if (P_LAYER_KIND == 1) {
    vec3 under = texture(uUnder, vUv).rgb;
    fragColor = vec4(mix(src, under, m), 1.0);
    return;
  }

  // Calque de teinte : rotation directe de la teinte, sans passer par HSL.
  vec3 graded = P_LAYER_KIND == 2
    ? fract(src + vec3(P_HUE_SHIFT, 0.0, 0.0))
    : applyPerceptualAdjustments(src);

  vec3 merged = applyBlendMode(src, graded, P_BLEND_MODE);
  fragColor = vec4(mix(src, merged, m), 1.0);
}
`

/* ==========================================================================
 * PASSE 5 — LUT 3D
 * ==========================================================================
 * La LUT est indexée en `sampler3D`. Une `.cube` 33³ tient dans une texture
 * 33×33×33 : l'interpolation trilineaire du GPU remplace un recalcul naïf
 * en O(n³) par frame, et le résultat est exact.
 * ========================================================================== */

export const LUT_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 vUv;
out vec4 fragColor;

${GLSL_COMMON}
${GLSL_PARAMS}

uniform sampler2D uSource;
uniform sampler3D uLut;
uniform int uLutSize;      // 33, 65…
uniform float uLutEnabled; // 0 = pas de texture liee

void main() {
  vec3 c = texture(uSource, vUv).rgb;

  if (uLutEnabled < 0.5) {
    fragColor = vec4(c, 1.0);
    return;
  }

  // Échantillonnage au centre des cellules : évite un biais de demi-voxel.
  vec3 coord = (clamp(c, 0.0, 1.0) * float(uLutSize - 1) + 0.5) / float(uLutSize);
  vec3 graded = texture(uLut, coord).rgb;

  fragColor = vec4(mix(c, clamp(graded, 0.0, 1.0), P_LUT_INTENSITY), 1.0);
}
`

/* ==========================================================================
 * PASSE 6 — EFFETS + ENCODAGE sRGB
 * ==========================================================================
 * Dernière passe avant présentation. Elle travaille déjà en perceptuel et
 * sort en sRGB, prêt pour le framebuffer d'affichage.
 * ========================================================================== */

export const FX_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

${GLSL_COMMON}
${GLSL_PARAMS}

uniform sampler2D uSource;
uniform vec2 uResolution;
uniform float uFrame;

/** Bruit de valeur hashé, stable et sans texture externe. */
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 c = clamp(texture(uSource, vUv).rgb, 0.0, 1.0);

  // Vignetage : atténuation radiale, un tiers plus forte sur les couleurs
  // que sur la luminance pour éviter la teinte mauve caractéristique.
  float vig = P_VIGNETTE;
  if (abs(vig) > 0.002) {
    vec2 p = vUv - 0.5;
    p.x *= uResolution.x / max(uResolution.y, 1.0);
    float d = length(p) * 1.414;
    float mask = smoothstep(1.0, 0.25, d);
    c *= 1.0 + vig * 0.9 * mask;
  }

  // Grain : bruit plus visible dans les basses lumières, comme un film.
  float grain = P_GRAIN;
  if (grain > 0.002) {
    float n = hash(gl_FragCoord.xy + uFrame) - 0.5;
    float l = luma(c);
    c += n * grain * 0.12 * mix(1.0, 0.35, l);
  }

  // La passe effets travaille en PERCEPTUEL (gamma 2.2). Pour l'affichage on
  // repasse en linéaire puis on applique la courbe sRGB exacte — sinon on
  // encode deux fois et l'image ressort délavée.
  fragColor = vec4(linearToSrgb(perceptualToLinear(clamp(c, 0.0, 1.0))), 1.0);
}
`

/* ==========================================================================
 * PASSE 7 — PRÉSENTATION
 * ==========================================================================
 * Unique passe qui écrit dans le framebuffer par défaut. Gère la
 * transformation de vue (zoom / panoramique), la planche de transparence et
 * le comparateur avant / après. C'est aussi la seule passe dont la résolution
 * est celle du canvas, pas celle de l'image.
 * ========================================================================== */

export const PRESENT_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

${GLSL_COMMON}

uniform sampler2D uImage;    // sortie de la passe effets, en sRGB
uniform sampler2D uOriginal; // source, avant tout réglage
uniform vec2 uViewOffset;    // décalage, en fraction de canvas
uniform vec2 uViewScale;     // fraction du canvas occupée par l'image
uniform float uBypass;       // 1 = afficher l'original
uniform float uSplit;        // position du comparateur, -1 = désactivé
uniform float uShowMask;     // visualisation du masque actif
uniform sampler2D uMaskPreview;
uniform float uHasImage;

void main() {
  // Espace écran → espace image.
  vec2 p = (vUv - 0.5 - uViewOffset) / max(uViewScale, vec2(1e-4)) + 0.5;
  vec2 uv = vec2(p.x, 1.0 - p.y);

  bool outside = p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0;
  if (outside || uHasImage < 0.5) {
    // Planche de transparence, en coordonnées écran pour rester stable.
    float s = mod(floor(gl_FragCoord.x / 12.0) + floor(gl_FragCoord.y / 12.0), 2.0);
    vec3 board = mix(vec3(0.16), vec3(0.21), s);
    fragColor = vec4(board, 1.0);
    return;
  }

  bool useOriginal = uBypass > 0.5 || (uSplit >= 0.0 && vUv.x < uSplit);
  vec3 c = useOriginal
    ? linearToSrgb(texture(uOriginal, uv).rgb)
    : texture(uImage, uv).rgb;

  if (uShowMask > 0.5) {
    c = vec3(texture(uMaskPreview, uv).r);
  }

  fragColor = vec4(c, 1.0);
}
`
