/**
 * Shaders de la couche « masque ».
 *
 * Un masque est un framebuffer `R8` de la taille de l'image. On y écrit
 * directement au pinceau : aucune géométrie vectorielle, aucun rendu
 * Canvas2D intermédiaire. C'est ce qui permet de peindre à 60 fps sur une
 * image de 50 Mpx sans changer une ligne du code d-upload.
 */

/* ==========================================================================
 * PINCEAU — une empreinte circulaire
 * ==========================================================================
 * On ne dessine qu'une fenêtre autour de l'empreinte (viewport + scissor) :
 * le coût par point est donc indépendant de la taille de l'image.
 * ========================================================================== */

export const BRUSH_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uRegionMin;   // coin de la fenêtre, en pixels image
uniform vec2 uRegionSize;  // taille de la fenêtre, en pixels image
uniform vec2 uCenter;      // centre de l'empreinte, en pixels image
uniform float uRadius;     // rayon, en pixels image
uniform float uHardness;   // 0 = bord très doux, 1 = bord dur
uniform float uFlow;       // opacité de l'empreinte unique
uniform vec3 uColor;       // blanc (révéler) ou noir (effacer)

void main() {
  vec2 p = uRegionMin + vUv * uRegionSize;
  float d = length(p - uCenter) / max(uRadius, 0.0001);

  if (d > 1.0) discard;

  // Le plateau central est d'autant plus large que le pinceau est dur.
  float inner = clamp(uHardness * 0.92, 0.0, 0.92);
  float alpha = 1.0 - smoothstep(inner, 1.0, d);
  alpha = pow(alpha, mix(1.8, 0.6, uHardness));

  fragColor = vec4(uColor, alpha * uFlow);
}
`

/* ==========================================================================
 * ADOUCISSEMENT DU MASQUE (feather)
 * ==========================================================================
 * Gaussienne séparable en deux passes, rayon haloïque. On filtre une
 * COPIE du masque : adoucir ne doit jamais détruire la peinture, sinon on
 * perdrait des pixels à chaque changement de réglage.
 * ========================================================================== */

export const BLUR_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSource;
uniform vec2 uDirection;  // (1/width, 0) puis (0, 1/height), en texels
uniform float uRadius;    // écart-type, en texels
uniform int uSamples;     // taps de chaque côté

void main() {
  if (uRadius < 0.05) {
    fragColor = texture(uSource, vUv);
    return;
  }

  // Poids gaussiens normalisés, calculés une fois dans la boucle.
  float sigma2 = 2.0 * uRadius * uRadius;
  vec3 sum = vec3(0.0);
  float total = 0.0;

  for (int i = -16; i <= 16; ++i) {
    if (i < -uSamples || i > uSamples) continue;
    float fi = float(i);
    float w = exp(-(fi * fi) / sigma2);
    sum += texture(uSource, vUv + uDirection * fi).rgb * w;
    total += w;
  }

  fragColor = sum / max(total, 1e-4);
}
`

/** Rendu du masque seul, en niveaux de gris, pour la visualisation. */
export const MASK_VIEW_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uMask;
uniform float uInverted;

void main() {
  float m = texture(uMask, vUv).r;
  fragColor = vec4(vec3(mix(m, 1.0 - m, uInverted)), 1.0);
}
`

/** Passe de copie identité, utile pour cloner une cible de rendu. */
export const COPY_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSource;

void main() {
  fragColor = texture(uSource, vUv);
}
`
