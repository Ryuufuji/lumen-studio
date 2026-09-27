/**
 * Fragments GLSL partagés par toutes les passes.
 *
 * Convention d'espace colorimétrique :
 *  - `uSource` (image) est en LINÉAIRE, issu d'une texture SRGB8_ALPHA8
 *    que le GPU décode au moment du prélèvement.
 *  - Les passes 1 (tonal) et 2 (perceptuel) s'exécutent dans cet espace.
 *  - À partir de la passe « couleur », tout est en PERCEPTUEL (gamma 2.2),
 *    ce qui est l'espace naturel des courbes, du HSL et des LUTs.
 *  - La passe d'effets ré-encode en sRGB pour l'affichage.
 *
 * Les paramètres ne voyagent pas en `uniform` nominatifs : tout passe par une
 * petite texture de données (4 × 16 texels RGBA32F) lus avec `texelFetch`.
 * Un seul upload par passe, aucune limite d'uniforms, et le mapping TS ↔ GLSL
 * est décrit dans `src/lib/gl/params.ts`.
 */

export const GLSL_COMMON = /* glsl */ `
const float EPS = 1e-6;
const float LUMA_R = 0.2126;
const float LUMA_G = 0.7152;
const float LUMA_B = 0.0722;

float luma(vec3 c) { return dot(c, vec3(LUMA_R, LUMA_G, LUMA_B)); }

vec3 saturateColor(vec3 c, float amount) {
  return max(mix(vec3(luma(c)), c, 1.0 + amount), vec3(0.0));
}

// --- Espaces colorimétriques ------------------------------------------------

vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

/** Linéaire → perceptuel. C'est l'espace des courbes, du HSL et des LUTs. */
vec3 linearToPerceptual(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }
vec3 perceptualToLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

// --- HSL --------------------------------------------------------------------

// Conversion HSL écrite sans aucune fonction intégrée à surcharge : c'est
// plus verbeux, mais cela compile à l'identique sur tous les pilotes, y
// compris ceux qui refusent fmod sur certaines versions d'ANGLE.
vec3 rgb2hsl(vec3 c) {
  float maxC = max(max(c.r, c.g), c.b);
  float minC = min(min(c.r, c.g), c.b);
  float l = 0.5 * (maxC + minC);
  float d = maxC - minC;

  if (d < EPS) return vec3(0.0, 0.0, l);

  float denom = l > 0.5 ? (2.0 - maxC - minC) : (maxC + minC);
  float s = clamp(d / max(denom, EPS), 0.0, 1.0);

  float h;
  if (maxC == c.r) {
    h = (c.g - c.b) / d;
    if (h < 0.0) h += 6.0;
  } else if (maxC == c.g) {
    h = 2.0 + (c.b - c.r) / d;
  } else {
    h = 4.0 + (c.r - c.g) / d;
  }
  h /= 6.0;
  if (h < 0.0) h += 1.0;

  return vec3(h, s, l);
}

float hueChannel(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 0.16666667) return p + (q - p) * (t / 0.16666667);
  if (t < 0.5) return q;
  if (t < 0.66666667) return p + (q - p) * ((0.66666667 - t) / 0.16666667);
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  if (hsl.y < EPS) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(
    hueChannel(p, q, hsl.x + 0.33333333),
    hueChannel(p, q, hsl.x),
    hueChannel(p, q, hsl.x - 0.33333333)
  );
}

// --- Filtres locaux ---------------------------------------------------------

/** Noyau en anneau de 8 taps, orienté pour limiter le moiré. */
const vec2 RING[8] = vec2[8](
  vec2( 1.0,  0.0), vec2( 0.707,  0.707), vec2( 0.0,  1.0), vec2(-0.707,  0.707),
  vec2(-1.0,  0.0), vec2(-0.707, -0.707), vec2(0.0, -1.0), vec2( 0.707, -0.707)
);

/** Moyenne en anneau, en pixels image. */
vec3 ringBlur(sampler2D tex, vec2 uv, vec2 texel, float radius) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 8; ++i) {
    sum += texture(tex, uv + RING[i] * texel * radius).rgb;
  }
  return sum * 0.125;
}

/** Masque flou : accentuation locale, base de « texture », « clarté », « netteté ». */
vec3 unsharp(sampler2D tex, vec2 uv, vec2 texel, float radius, float amount) {
  vec3 c = texture(tex, uv).rgb;
  if (abs(amount) < 0.002) return c;
  return max(c + (c - ringBlur(tex, uv, texel, radius)) * amount, vec3(0.0));
}

/**
 * Même chose, mais renvoie seulement l'écart au centre : permet d'empiler
 * plusieurs accents locales sans que le résultat de l'un n'écrase celui de
 * l'autre.
 */
vec3 unsharpDelta(sampler2D tex, vec2 uv, vec2 texel, float radius, float amount) {
  if (abs(amount) < 0.002) return vec3(0.0);
  vec3 c = texture(tex, uv).rgb;
  return (c - ringBlur(tex, uv, texel, radius)) * amount;
}

// --- Tone mapping -----------------------------------------------------------

vec3 tonemapFilmic(vec3 x) {
  // Uncharted 2, sans le white point : suffisamment proche, une divide de moins.
  const float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

vec3 tonemapAces(vec3 x) {
  // Fit exponentiel de Narkowicz : une seule passe, pas de matrice 3x3.
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

/** mode : 0 aucune · 1 Reinhard · 2 filmique · 3 ACES */
vec3 applyTonemap(vec3 x, int mode) {
  if (mode == 1) return x / (1.0 + x);
  if (mode == 2) return clamp(tonemapFilmic(x * 0.6) / tonemapFilmic(vec3(11.2)), 0.0, 1.0);
  if (mode == 3) return tonemapAces(x);
  return x;
}
`

/**
 * Accès aux paramètres par texture de données.
 *
 * La texture fait 4 texels de large sur 16 de haut en RGBA32F. Chaque ligne
 * regroupe 4 paramètres selon la table de `src/lib/gl/params.ts`.
 */
export const GLSL_PARAMS = /* glsl */ `
uniform sampler2D uParams;

#define P_EXPOSURE      texelFetch(uParams, ivec2(0, 0), 0).r
#define P_CONTRAST      texelFetch(uParams, ivec2(1, 0), 0).g
#define P_HIGHLIGHTS    texelFetch(uParams, ivec2(2, 0), 0).b
#define P_SHADOWS       texelFetch(uParams, ivec2(3, 0), 0).a

#define P_WHITES        texelFetch(uParams, ivec2(0, 1), 0).r
#define P_BLACKS        texelFetch(uParams, ivec2(1, 1), 0).g
#define P_BRIGHTNESS    texelFetch(uParams, ivec2(2, 1), 0).b
#define P_VIGNETTE      texelFetch(uParams, ivec2(3, 1), 0).a

#define P_SATURATION    texelFetch(uParams, ivec2(0, 2), 0).r
#define P_VIBRANCE      texelFetch(uParams, ivec2(1, 2), 0).g
#define P_CLARITY       texelFetch(uParams, ivec2(2, 2), 0).b
#define P_GRAIN         texelFetch(uParams, ivec2(3, 2), 0).a

#define P_SHARPNESS     texelFetch(uParams, ivec2(0, 3), 0).r
#define P_TEXTURE       texelFetch(uParams, ivec2(1, 3), 0).g
#define P_DEHAZE        texelFetch(uParams, ivec2(2, 3), 0).b
#define P_TONEMAP       int(texelFetch(uParams, ivec2(3, 3), 0).a + 0.5)

#define P_LUT_INTENSITY texelFetch(uParams, ivec2(0, 4), 0).r
#define P_BYPASS        texelFetch(uParams, ivec2(1, 4), 0).g
#define P_OPACITY       texelFetch(uParams, ivec2(2, 4), 0).b
#define P_DENSITY       texelFetch(uParams, ivec2(3, 4), 0).a

#define P_LAYER_KIND    int(texelFetch(uParams, ivec2(0, 5), 0).r + 0.5)
#define P_HUE_SHIFT     texelFetch(uParams, ivec2(1, 5), 0).g
#define P_BLEND_MODE    int(texelFetch(uParams, ivec2(2, 5), 0).b + 0.5)

/** Teintes de référence des 8 bandes HSL, en degrés. */
const float HUE_CENTER[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0);

/** Poids d'une bande sur une teinte donnée : plateau de 18°, fondu jusqu'à 60°. */
float hueWeight(float hue, float center) {
  float d = abs(mod(hue - center + 180.0, 360.0) - 180.0);
  return 1.0 - smoothstep(18.0, 60.0, d);
}
`

/** Réglages colorimétriques perçus : courbes, HSL, vibrance, plages de tons. */
export const GLSL_PERCEPTUAL_ADJUST = /* glsl */ `
uniform sampler2D uCurve;

/**
 * Courbe maîtresse + courbes par canal, pré-composées en une texture 256×1.
 * Chaque canal s'indexe lui-même dans la table : le rgb de la texture est
 * DÉJÀ la composition « courbe du canal puis courbe maîtresse ».
 */
vec3 applyCurves(vec3 c) {
  return vec3(
    texture(uCurve, vec2(clamp(c.r, 0.0, 1.0), 0.5)).r,
    texture(uCurve, vec2(clamp(c.g, 0.0, 1.0), 0.5)).g,
    texture(uCurve, vec2(clamp(c.b, 0.0, 1.0), 0.5)).b
  );
}

/** Décale une plage de tons : exposition localisée, sans écrêtage. */
vec3 shiftRange(vec3 c, float amount, float lo, float hi) {
  float w = smoothstep(lo, hi, luma(c));
  if (lo + hi < 0.75) w = 1.0 - w; // plages hautes : on pondère les basses lumières
  return pow(max(c, vec3(0.0)), vec3(1.0 - amount * w));
}

/** 8 bandes HSL, appliquées séquentiellement pour rester contrôlables. */
vec3 applyHslBands(vec3 c) {
  // Court-circuit quand aucune bande n'est réglée : l'aller-retour
  // RGB → HSL → RGB n'est PAS sans perte et coûterait ~2 % d'écart sur les
  // couleurs très saturées. À zéro réglage, l'octet doit être identique.
  bool neutral = true;
  for (int i = 0; i < 8; ++i) {
    vec4 band = texelFetch(uParams, ivec2(0, 8 + i), 0);
    if (abs(band.r) > 0.001 || abs(band.g) > 0.001 || abs(band.b) > 0.001) {
      neutral = false;
      break;
    }
  }
  if (neutral) return c;

  vec3 hsl = rgb2hsl(clamp(c, 0.0, 1.0));
  float hue = hsl.x * 360.0;

  for (int i = 0; i < 8; ++i) {
    vec4 band = texelFetch(uParams, ivec2(0, 8 + i), 0);
    float w = hueWeight(hue, HUE_CENTER[i]);
    if (w < 0.001) continue;
    // Teinte en degrés (±30 au maximum), saturation et luminance en
    // fraction de la plage HSL : les trois sont des réglages [-1,1].
    // mod() avec un diviseur positif rend déjà un résultat dans [0,360) :
    // ne surtout PAS ajouter 180 ici, cela décalerait la teinte de
    // 180° à chaque bande touchée.
    hue = mod(hue + band.r * 30.0 * w, 360.0);
    hsl.y = clamp(hsl.y + band.g * 0.5 * w, 0.0, 1.0);
    hsl.z = clamp(hsl.z + band.b * 0.5 * w, 0.0, 1.0);
  }

  hsl.x = hue / 360.0;
  return hsl2rgb(hsl);
}

/**
 * Bloc de réglages perçus, réutilisé tel quel par la passe globale et par
 * chaque calque de masque : mêmes équations, donc un calque se comporte
 * exactement comme les réglages globaux qu'il réplique.
 */
vec3 applyPerceptualAdjustments(vec3 c) {
  c = clamp(c, 0.0, 1.0);

  // Contraste autour du gris moyen.
  c = 0.5 * pow(max(c / 0.5, vec3(EPS)), vec3(1.0 + P_CONTRAST));

  // Plages de tons.
  c = shiftRange(c, P_HIGHLIGHTS * 0.6, 0.45, 1.0);
  c = shiftRange(c, P_SHADOWS * 0.6, 0.0, 0.45);

  // Noirs et blancs : déplacement du point noir et du point blanc.
  float b = P_BLACKS * 0.35;
  float w = P_WHITES * 0.35;
  c = clamp((c - b) / max(1.0 - b + w, 0.05), 0.0, 1.0);

  // Luminosité.
  c *= 1.0 + P_BRIGHTNESS * 0.5;

  // Courbes.
  c = applyCurves(c);

  // Couleur.
  c = applyHslBands(c);

  // Saturation : -1 désature de moitié, +1 double. C'est la convention
  // Lightroom, et c'est le seul mapping qui rend le curseur utile.
  c = saturateColor(c, P_SATURATION);

  // Vibrance : agit surtout sur les teintes peu saturées, comme dans Lightroom.
  float maxC = max(max(c.r, c.g), c.b);
  float minC = min(min(c.r, c.g), c.b);
  float sat = maxC > EPS ? (maxC - minC) / maxC : 0.0;
  c = saturateColor(c, P_VIBRANCE * 0.9 * (1.0 - sat));

  return clamp(c, 0.0, 1.0);
}
`

/** Modes de fusion — équations normalisées, aucun espace implicite. */
export const GLSL_BLEND = /* glsl */ `
/** Un seul canal d'un mode de fusion normalisé (base, source dans [0,1]). */
float blendChannel(float b, float s, int mode) {
  if (mode == 1) return b * s;                                   // multiply
  if (mode == 2) return b + s - b * s;                           // screen
  if (mode == 3) return b <= 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s); // overlay
  if (mode == 4) {                                                // soft-light
    if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
    float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
    return b + (2.0 * s - 1.0) * (d - b);
  }
  return s;                                                       // normal
}

vec3 applyBlendMode(vec3 base, vec3 source, int mode) {
  if (mode == 0) return source;

  vec3 blended = vec3(
    blendChannel(base.r, source.r, mode),
    blendChannel(base.g, source.g, mode),
    blendChannel(base.b, source.b, mode)
  );

  if (mode == 5) { // luminosity — la chromatique vient de source
    float lb = luma(blended);
    return clamp(source + lb - luma(source), 0.0, 1.0);
  }
  if (mode == 6) { // color — seule la luminance est prise dans base
    float lb = luma(base);
    return clamp(base * (luma(source) / max(lb, EPS)), 0.0, 1.0);
  }
  if (mode == 7) { // hue — teinte de source, luminance de base
    vec3 hs = rgb2hsl(clamp(source, 0.0, 1.0));
    vec3 hb = rgb2hsl(clamp(base, 0.0, 1.0));
    return hsl2rgb(vec3(hs.x, hs.y, hb.z));
  }

  return clamp(blended, 0.0, 1.0);
}
`
