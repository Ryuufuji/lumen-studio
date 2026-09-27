/**
 * Génération des LUTs système.
 *
 *   node scripts/generate-system-luts.mjs
 *
 * Produit, dans `public/luts/system/` :
 *   - un `.cube` 33³ par look
 *   - `catalog.json`, le manifeste lu par l'application
 *
 * Les tables sont SYNTHÉTISÉES, pas copiées : une suite d'opérateurs
 * colorimétriques (courbe, saturation, split-toning, virage) décrit chaque
 * look, et la table est calculée. Le résultat est donc libre de droits,
 * déterministe, et reproductible par `npm run lut:generate`.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'public', 'luts', 'system')
const SIZE = 33

/* ==========================================================================
 * Opérateurs colorimétriques
 * ==========================================================================
 * Chaque fonction opère sur un triplet [r, g, b] normalisé et renvoie un
 * triplet. Les tables sont composées en appliquant ces fonctions point par
 * point sur la cube identité : le code reste lisible et chaque look est
 * décrit par une liste d'opérations, pas par une matrice magic.
 * ========================================================================== */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a, b, t) => a + (b - a) * t

/**
 * Courbe de contraste par exposantes autour d'un pivot.
 * `amount > 0` durcit les demi-teintes des deux côtés, `amount < 0` les
 * détend. C'est le modèle de la plupart des courbes de base des sièges.
 */
function gamma(amount, pivot = 0.45) {
  return ([r, g, b]) => {
    const f = (c) => {
      if (c <= pivot) return clamp01(pivot * Math.pow(c / Math.max(pivot, 1e-6), 1 + amount))
      return clamp01(pivot + (1 - pivot) * Math.pow((c - pivot) / (1 - pivot), 1 - amount * 0.6))
    }
    return [f(r), f(g), f(b)]
  }
}

/** Relève les noirs : look « filmique » à noirs mats. */
function liftedBlocks(amount, tintR = 0, tintG = 0, tintB = 0) {
  return ([r, g, b]) => [
    clamp01(r + amount * 0.09 + amount * tintR),
    clamp01(g + amount * 0.09 + amount * tintG),
    clamp01(b + amount * 0.11 + amount * tintB),
  ]
}

/** Écrase les noirs sous un seuil : rendu contrasté, type « punchy ». */
function crushBlocks(threshold) {
  return ([r, g, b]) => {
    const f = (c) => {
      const t = clamp01((c - threshold) / (1 - threshold))
      return clamp01(t * t * (3 - 2 * t))
    }
    return [f(r), f(g), f(b)]
  }
}

/** Saturation autour de la luminance. */
function saturation(amount) {
  return ([r, g, b]) => {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return [clamp01(l + (r - l) * amount), clamp01(l + (g - l) * amount), clamp01(l + (b - l) * amount)]
  }
}

/** Rotation de la teinte, en degrés. */
function hueRotate(degrees) {
  const rad = (degrees * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const m = [
    [0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928],
    [0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283],
    [0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072],
  ]
  return ([r, g, b]) => [
    clamp01(m[0][0] * r + m[0][1] * g + m[0][2] * b),
    clamp01(m[1][0] * r + m[1][1] * g + m[1][2] * b),
    clamp01(m[2][0] * r + m[2][1] * g + m[2][2] * b),
  ]
}

/** Teintage sélectif des ombres et des hautes lumières. */
function splitTone(shadowRgb, highlightRgb, balance = 0.5) {
  return ([r, g, b]) => {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const wShadow = Math.pow(1 - l, 2) * (1 - balance)
    const wHigh = Math.pow(l, 2) * balance
    return [
      clamp01(r + (shadowRgb[0] - 0.5) * wShadow * 0.5 + (highlightRgb[0] - 0.5) * wHigh * 0.5),
      clamp01(g + (shadowRgb[1] - 0.5) * wShadow * 0.5 + (highlightRgb[1] - 0.5) * wHigh * 0.5),
      clamp01(b + (shadowRgb[2] - 0.5) * wShadow * 0.5 + (highlightRgb[2] - 0.5) * wHigh * 0.5),
    ]
  }
}

/** Gain RGB global : la « température » du look. */
function gain([gr, gg, gb]) {
  return (rgb) => [clamp01(rgb[0] * gr), clamp01(rgb[1] * gg), clamp01(rgb[2] * gb)]
}

/** Aplatit les hautes lumières vers une couleur : effet « silver ». */
function channelMixer(matrix) {
  return ([r, g, b]) => [
    clamp01(matrix[0][0] * r + matrix[0][1] * g + matrix[0][2] * b),
    clamp01(matrix[1][0] * r + matrix[1][1] * g + matrix[1][2] * b),
    clamp01(matrix[2][0] * r + matrix[2][1] * g + matrix[2][2] * b),
  ]
}

/** Conversion vers le noir et blanc, avec un voile de couleur. */
function monochrome(veil = [0, 0, 0], strength = 0.06) {
  return ([r, g, b]) => {
    const l = clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b)
    return [clamp01(l + veil[0] * strength), clamp01(l + veil[1] * strength), clamp01(l + veil[2] * strength)]
  }
}

/** Inversion partielle : rendu « solarisé ». */
function solarize(threshold) {
  const flip = (c) => (c < threshold ? c : 1 - (c - threshold) / (1 - threshold))
  return ([r, g, b]) => [clamp01(flip(r)), clamp01(flip(g)), clamp01(flip(b))]
}

/* ==========================================================================
 * Catalogue
 * ========================================================================== */

const CINEMATIC_MATRIX = [
  [1.06, -0.03, -0.03],
  [-0.04, 1.05, -0.01],
  [-0.02, -0.02, 1.04],
]

const LOOKS = [
  // --- Cinematic -------------------------------------------------------
  {
    group: 'cinematic',
    slug: 'cinematic-teal-orange',
    name: 'Teal & Orange',
    description: "Contraste cinématographique, ombres froides et hautes lumières chaudes.",
    author: 'Lumen Studio',
    operators: [gamma(0.18), splitTone([0.20, 0.36, 0.46], [0.98, 0.88, 0.72], 0.55), saturation(1.12)],
  },
  {
    group: 'cinematic',
    slug: 'cinematic-bleach-bypass',
    name: 'Bleach Bypass',
    description: 'Silver halide : contraste sec, désaturation légère.',
    author: 'Lumen Studio',
    operators: [crushBlocks(0.08), gamma(0.4), saturation(0.82)],
  },
  {
    group: 'cinematic',
    slug: 'cinematic-blockbuster',
    name: 'Blockbuster Contrast',
    description: 'Noirs profonds, hautes lumières brûlées, courbe S appliquée.',
    author: 'Lumen Studio',
    operators: [crushBlocks(0.14), gain([1.03, 1.0, 0.97]), splitTone([0.18, 0.24, 0.40], [1.0, 0.94, 0.80], 0.5)],
  },
  {
    group: 'cinematic',
    slug: 'cinematic-navy-fade',
    name: 'Navy Fade',
    description: 'Bleu nuit, noirs délavés, ambiance urbaine.',
    author: 'Lumen Studio',
    operators: [liftedBlocks(0.5, 0.0, 0.0, 0.05), gamma(0.12), splitTone([0.14, 0.26, 0.50], [0.86, 0.90, 1.0], 0.5)],
  },
  {
    group: 'cinematic',
    slug: 'cinematic-sunset-gold',
    name: 'Sunset Gold',
    description: 'Hautes lumières dorées, ombres magenta.',
    author: 'Lumen Studio',
    operators: [gamma(0.15), splitTone([0.42, 0.24, 0.40], [1.0, 0.84, 0.52], 0.6), saturation(1.08)],
  },
  {
    group: 'cinematic',
    slug: 'cinematic-matte',
    name: 'Matte Film',
    description: 'Noirs relevés, rendu pellicule mate.',
    author: 'Lumen Studio',
    operators: [liftedBlocks(0.75, 0.02, 0.01, 0.0), gamma(-0.12), saturation(0.9)],
  },

  // --- Fujifilm --------------------------------------------------------
  {
    group: 'film-emulation',
    slug: 'fujifilm-classic-chrome',
    name: 'Classic Chrome',
    description: 'Couleurs sourdes, ombres vert-olive, rendu journal.',
    author: 'Dérivé Fujifilm',
    operators: [crushBlocks(0.06), splitTone([0.30, 0.34, 0.24], [0.90, 0.86, 0.80], 0.5), saturation(0.84)],
  },
  {
    group: 'film-emulation',
    slug: 'fujifilm-astia',
    name: 'Astia',
    description: 'Couleurs douces, contraste modéré, peau flattenée.',
    author: 'Dérivé Fujifilm',
    operators: [liftedBlocks(0.3, 0.0, 0.01, 0.0), gamma(0.08), saturation(1.05)],
  },
  {
    group: 'film-emulation',
    slug: 'fujifilm-provia',
    name: 'Provia',
    description: 'Négatif standard, couleurs denses, usage général.',
    author: 'Dérivé Fujifilm',
    operators: [gamma(0.12), saturation(1.14), gamma(0.12)],
  },
  {
    group: 'film-emulation',
    slug: 'fujifilm-velvia',
    name: 'Velvia',
    description: 'Saturations élevées, tons très froids. Paysages.',
    author: 'Dérivé Fujifilm',
    operators: [gain([1.0, 1.0, 1.04]), gamma(0.24), saturation(1.45), gamma(0.1)],
  },
  {
    group: 'film-emulation',
    slug: 'fujifilm-eterna',
    name: 'Eterna',
    description: 'Ombres vertes, rendu cinéma discret.',
    author: 'Dérivé Fujifilm',
    operators: [splitTone([0.24, 0.40, 0.28], [0.88, 0.90, 0.86], 0.5), liftedBlocks(0.35, 0.0, 0.02, 0.0), saturation(0.78)],
  },
  {
    group: 'film-emulation',
    slug: 'fujifilm-acros',
    name: 'Acros',
    description: 'Noir et blanc avec grain fin et courbe douce.',
    author: 'Dérivé Fujifilm',
    operators: [monochrome([0.0, 0.0, 0.01], 0.08), gamma(0.1)],
  },

  // --- Vintage ----------------------------------------------------------
  {
    group: 'vintage',
    slug: 'vintage-portra-warm',
    name: 'Portra 400 Warm',
    description: 'Doré, tons chairs légèrement délavés.',
    author: 'Interprétation libre',
    operators: [liftedBlocks(0.45, 0.04, 0.02, 0.0), splitTone([0.44, 0.34, 0.28], [1.0, 0.90, 0.74], 0.55), saturation(0.88)],
  },
  {
    group: 'vintage',
    slug: 'vintage-kodak-gold',
    name: 'Kodak Gold 200',
    description: 'Jaunes chauds, ombres orangées.',
    author: 'Interprétation libre',
    operators: [gamma(0.14), gain([1.06, 1.0, 0.88]), saturation(1.02), liftedBlocks(0.3, 0.03, 0.01, 0.0)],
  },
  {
    group: 'vintage',
    slug: 'vintage-ektachrome',
    name: 'Ektachrome Shift',
    description: 'Cyan des ombres, look années 70.',
    author: 'Interprétation libre',
    operators: [splitTone([0.20, 0.44, 0.54], [1.0, 0.86, 0.62], 0.5), saturation(0.96), gamma(0.1)],
  },
  {
    group: 'vintage',
    slug: 'vintage-faded-polaroid',
    name: 'Faded Polaroid',
    description: 'Noirs laiteux, contraste très bas.',
    author: 'Interprétation libre',
    operators: [liftedBlocks(0.95, 0.02, 0.01, 0.03), gamma(-0.18), saturation(0.78)],
  },
  {
    group: 'vintage',
    slug: 'vintage-sepia',
    name: 'Sepia Tone',
    description: 'Virage sépia classique, contraste doux.',
    author: 'Interprétation libre',
    operators: [channelMixer([[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]]), gamma(0.1)],
  },

  // --- Noir & blanc -----------------------------------------------------
  {
    group: 'bw',
    slug: 'bw-high-contrast',
    name: 'High Contrast Mono',
    description: 'Courbe S forte, noirs et blancs nets.',
    author: 'Lumen Studio',
    operators: [monochrome(), crushBlocks(0.05), gamma(0.35)],
  },
  {
    group: 'bw',
    slug: 'bw-soft-silver',
    name: 'Soft Silver',
    description: 'Courbe S douce, blanc lumineux, rendu portrait.',
    author: 'Lumen Studio',
    operators: [monochrome([0.01, 0.01, 0.02], 0.1), liftedBlocks(0.4), gamma(-0.1)],
  },
  {
    group: 'bw',
    slug: 'bw-panchromatic',
    name: 'Panchromatic',
    description: 'Rend les verts sombres, ciel classique.',
    author: 'Lumen Studio',
    operators: [channelMixer([[0.28, 0.63, 0.09], [0.28, 0.63, 0.09], [0.28, 0.63, 0.09]]), gamma(0.2)],
  },
  {
    group: 'bw',
    slug: 'bw-infrared',
    name: 'Infrared Film',
    description: 'Noir et blanc très contrasté, atmosphère.',
    author: 'Lumen Studio',
    operators: [channelMixer([[0.4, 0.5, 0.1], [0.4, 0.5, 0.1], [0.4, 0.5, 0.1]]), crushBlocks(0.12), gain([1.0, 1.0, 1.05])],
  },

  // --- Créatives --------------------------------------------------------
  {
    group: 'creative',
    slug: 'creative-cyberpunk',
    name: 'Cyberpunk',
    description: 'Magenta et cyan, très saturé.',
    author: 'Lumen Studio',
    operators: [splitTone([0.30, 0.10, 0.50], [0.55, 0.85, 1.0], 0.5), saturation(1.5), gamma(0.14)],
  },
  {
    group: 'creative',
    slug: 'creative-solarize',
    name: 'Solarize',
    description: 'Inversion partielle, rendu psychédélique.',
    author: 'Lumen Studio',
    operators: [solarize(0.62), saturation(1.35)],
  },
  {
    group: 'creative',
    slug: 'creative-arctic',
    name: 'Arctic Cold',
    description: 'Bleu glacier, désaturation des rouges.',
    author: 'Lumen Studio',
    operators: [channelMixer(CINEMATIC_MATRIX), gain([0.92, 1.0, 1.12]), saturation(0.9), gamma(0.12)],
  },
  {
    group: 'creative',
    slug: 'creative-desert',
    name: 'Desert Warm',
    description: 'Sable et ocre, split-toning marqué.',
    author: 'Lumen Studio',
    operators: [splitTone([0.30, 0.24, 0.34], [1.0, 0.88, 0.62], 0.6), saturation(1.15), liftedBlocks(0.2, 0.03, 0.01, 0.0)],
  },
]

/* ==========================================================================
 * Génération
 * ========================================================================== */

function buildCube(operators) {
  const data = new Float32Array(SIZE * SIZE * SIZE * 3)

  for (let b = 0; b < SIZE; b += 1) {
    for (let g = 0; g < SIZE; g += 1) {
      for (let r = 0; r < SIZE; r += 1) {
        let rgb = [r / (SIZE - 1), g / (SIZE - 1), b / (SIZE - 1)]
        for (const op of operators) rgb = op(rgb)
        const i = (b * SIZE * SIZE + g * SIZE + r) * 3
        data[i] = clamp01(rgb[0])
        data[i + 1] = clamp01(rgb[1])
        data[i + 2] = clamp01(rgb[2])
      }
    }
  }

  return data
}

function toCubeText(title, data) {
  const lines = [
    `# ${title}`,
    '# Généré par scripts/generate-system-luts.mjs — libre de droits',
    `TITLE "${title}"`,
    '',
    `LUT_3D_SIZE ${SIZE}`,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
    '',
  ]

  for (let i = 0; i < SIZE ** 3; i += 1) {
    const r = data[i * 3].toFixed(6)
    const g = data[i * 3 + 1].toFixed(6)
    const b = data[i * 3 + 2].toFixed(6)
    lines.push(`${r} ${g} ${b}`)
  }

  return lines.join('\n') + '\n'
}

const GROUPS = [
  { slug: 'cinematic', name: 'Cinematic', description: 'Profils de graded films : teal & orange, bleach bypass.', icon: 'film' },
  { slug: 'film-emulation', name: 'Fujifilm', description: 'Simulations Fujifilm (Classic Chrome, Astia, Provia).', icon: 'camera' },
  { slug: 'vintage', name: 'Vintage', description: 'Ports analogiques, virage, grain argentique.', icon: 'clock' },
  { slug: 'bw', name: 'Noir & B&W', description: 'Conversions monochromes haute densité.', icon: 'contrast' },
  { slug: 'creative', name: 'Créatives', description: 'Looks très typés (cyberpunk, solarisé, froid).', icon: 'sparkles' },
]

await mkdir(OUT_DIR, { recursive: true })

const manifest = []
for (const look of LOOKS) {
  const data = buildCube(look.operators)
  await writeFile(join(OUT_DIR, `${look.slug}.cube`), toCubeText(look.name, data), 'utf8')
  manifest.push({
    slug: look.slug,
    name: look.name,
    group: look.group,
    description: look.description,
    author: look.author,
    url: `/luts/system/${look.slug}.cube`,
    size: SIZE,
  })
  process.stdout.write(`  ✓ ${look.slug}.cube\n`)
}

await writeFile(
  join(OUT_DIR, 'catalog.json'),
  JSON.stringify({ size: SIZE, groups: GROUPS, luts: manifest }, null, 2) + '\n',
  'utf8',
)

process.stdout.write(`\n${manifest.length} LUTs générées dans public/luts/system/\n`)
