/**
 * Génère l'icône de l'application (512×512 PNG).
 *
 *   node scripts/generate-icon.mjs
 *
 * Pourquoi un script plutôt qu'un fichier binaire versionné ? Parce qu'elle
 * est dérivée : la même source produit le PNG pour Linux, l'.ico pour Windows
 * et l'.icns pour macOS, tous générés par electron-builder à partir de ce seul
 * fichier. Et parce qu'aucune dépendance d'image n'est nécessaire — un PNG
 * n'est qu'un en-tête, des blocs zlib et un CRC.
 *
 * Le dessin : un objectif d'appareil photo —iris en dégradé d'accent sur le
 * fond de l'application. Volontairement géométrique, lisible à 16 px comme
 * à 512 px.
 */

import { deflateSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'build', 'icon.png')

const SIZE = 512

/* Les mêmes jetons que `globals.css`, thème pro-dark. */
const BG_TOP = [0x0b, 0x0d, 0x11]
const BG_BOTTOM = [0x05, 0x06, 0x08]
const ACCENT = [0x4c, 0x8d, 0xff]
const ACCENT_WARM = [0x38, 0xbd, 0xf8]

/** Les pixels RGBA bruts, calculés ligne par ligne. */
function renderPixels() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4)
  const center = (SIZE - 1) / 2
  const outerRadius = SIZE * 0.42
  const ringWidth = SIZE * 0.075
  const irisRadius = SIZE * 0.27

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const offset = (y * SIZE + x) * 4
      const t = y / (SIZE - 1)

      // Fond : dégradé vertical très sombre, l'icône ne doit pas « clignoter »
      // sur un fond clair comme sur un fond sombre.
      let r = Math.round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
      let g = Math.round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
      let b = Math.round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
      let a = 255

      const dx = x - center
      const dy = y - center
      const distance = Math.hypot(dx, dy)

      // Bague extérieure : anneau plein, dégradé accent -> cyan.
      if (distance <= outerRadius) {
        const mix = (distance - (outerRadius - ringWidth)) / ringWidth
        const clamped = Math.min(1, Math.max(0, mix))
        r = Math.round(ACCENT[0] + (ACCENT_WARM[0] - ACCENT[0]) * clamped)
        g = Math.round(ACCENT[1] + (ACCENT_WARM[1] - ACCENT[1]) * clamped)
        b = Math.round(ACCENT[2] + (ACCENT_WARM[2] - ACCENT[2]) * clamped)
      }

      // Iris : disque plein, plus sombre, pour que l'anneau se détache.
      if (distance <= irisRadius) {
        const shade = 0.18 + 0.22 * (1 - distance / irisRadius)
        r = Math.round(ACCENT[0] * shade)
        g = Math.round(ACCENT[1] * shade)
        b = Math.round(ACCENT[2] * shade)
      }

      // Ouverture centrale.
      if (distance <= irisRadius * 0.34) {
        r = 0x05
        g = 0x06
        b = 0x09
      }

      pixels[offset] = r
      pixels[offset + 1] = g
      pixels[offset + 2] = b
      pixels[offset + 3] = a
    }
  }

  return pixels
}

/** Une ligne de pixels est préfixée par son type de filtre (0 = aucun). */
function scanlines(pixels) {
  const stride = SIZE * 4
  const raw = Buffer.alloc((stride + 1) * SIZE)
  for (let y = 0; y < SIZE; y++) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return raw
}

/** CRC-32, table calculée une fois. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function encodePng(pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // profondeur de bit
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // filtre adaptatif
  ihdr[12] = 0 // pas d'entrelacement

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines(pixels), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, encodePng(renderPixels()))
process.stdout.write(`  ✓ build/icon.png (${SIZE}×${SIZE})\n`)
