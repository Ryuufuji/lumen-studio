/**
 * Validation des LUTs livrées.
 *
 *   node scripts/validate-luts.mjs
 *
 * Vérifie ce qu'un parseur distant ne dirait pas : dimensions, complétude de
 * la table, continuité, et absence d'écrêtage massif. Sert de garde-fou CI
 * après toute modification de `generate-system-luts.mjs`.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'public', 'luts', 'system')

let failures = 0
let warnings = 0

function report(file, message, level = 'error') {
  if (level === 'error') failures += 1
  else warnings += 1
  process.stdout.write(`  ${level === 'error' ? '✗' : '!'} ${file} — ${message}\n`)
}

const files = (await readdir(DIR)).filter((name) => name.endsWith('.cube')).sort()

/**
 * Certaines LUTs ont une discontinuité VOLONTAIRE : solariser consiste
 * précisément à inverser la courbe autour d'un seuil, ce qui crée un saut.
 * On les déclare ici plutôt que d'abaisser le seuil global et de laisser
 * passer les vraies erreurs.
 */
const ALLOWED_DISCONTINUITIES = new Set(['creative-solarize.cube'])

process.stdout.write(`Validation de ${files.length} LUTs dans ${DIR}\n\n`)

for (const file of files) {
  const text = await readFile(join(DIR, file), 'utf8')

  const sizeMatch = /LUT_3D_SIZE\s+(\d+)/i.exec(text)
  if (!sizeMatch) {
    report(file, 'LUT_3D_SIZE manquant')
    continue
  }
  const size = Number(sizeMatch[1])

  if (!/TITLE\s+"/i.test(text)) report(file, 'TITLE manquant', 'warn')

  const entries = []
  for (const line of text.split('\n')) {
    if (/^\s*#/.test(line) || /^\s*(TITLE|LUT_3D_SIZE|DOMAIN_MIN|DOMAIN_MAX)/i.test(line)) continue
    const m = /^\s*([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/.exec(line)
    if (m) entries.push(Number(m[1]), Number(m[2]), Number(m[3]))
  }

  const expected = size ** 3 * 3
  if (entries.length !== expected) {
    report(file, `${entries.length / 3} points, ${size ** 3} attendus`)
    continue
  }

  for (let i = 0; i < entries.length; i += 1) {
    if (!Number.isFinite(entries[i]) || entries[i] < 0 || entries[i] > 1.0001) {
      report(file, `valeur hors [0,1] à l'index ${i} : ${entries[i]}`)
      break
    }
  }

  // Continuité le long de l'axe rouge, et écrêtage.
  let maxJump = 0
  let clipped = 0
  const count = size ** 3

  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size - 1; r += 1) {
        const i = (b * size * size + g * size + r) * 3
        for (let c = 0; c < 3; c += 1) {
          const d = Math.abs(entries[i + c] - entries[i + 3 + c])
          if (d > maxJump) maxJump = d
          if (entries[i + c] <= 0.001 || entries[i + c] >= 0.999) clipped += 1
        }
      }
    }
  }

  if (size < 17) report(file, `résolution ${size}³ trop faible`, 'warn')
  if (maxJump > 0.2 && !ALLOWED_DISCONTINUITIES.has(file)) {
    report(file, `discontinuité de ${maxJump.toFixed(3)}`)
  }
  if (clipped / (count * 3) > 0.25) {
    report(file, `${Math.round((clipped / (count * 3)) * 100)} % de valeurs écrêtées`, 'warn')
  }

  process.stdout.write(`  ✓ ${file} (${size}³)\n`)
}

process.stdout.write(`\n${files.length} fichiers lus · ${warnings} avertissement(s) · ${failures} erreur(s)\n`)
process.exit(failures > 0 ? 1 : 0)
