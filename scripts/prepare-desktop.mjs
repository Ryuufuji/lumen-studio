/**
 * Prépare le bundle exécutable.
 *
 * `next build --output standalone` produit un serveur autonome, mais il ne
 * contient ni les assets statiques (`.next/static`) ni les fichiers de
 * `public/` : Next les sert normalement via le serveur de dev. Il faut donc
 * les recopier à l'intérieur avant d'embarquer le tout dans l'exécutable.
 *
 *   node scripts/prepare-desktop.mjs
 */

import { cp, access, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STANDALONE = join(ROOT, '.next', 'standalone')

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

if (!(await exists(STANDALONE))) {
  process.stderr.write(
    'Serveur standalone absent.\n' +
      'Lancez d\'abord `next build`, ou utilisez `npm run desktop:prepare`.\n',
  )
  process.exit(1)
}

// `.next/static` et `public/` vont à la RACINE du bundle : c'est là que le
// serveur autonome les cherche.
const targets = [
  [join(ROOT, '.next', 'static'), join(STANDALONE, '.next', 'static')],
  [join(ROOT, 'public'), join(STANDALONE, 'public')],
]

for (const [from, to] of targets) {
  if (!(await exists(from))) {
    process.stdout.write(`  · ignoré (absent) : ${from}\n`)
    continue
  }
  await rm(to, { recursive: true, force: true })
  await cp(from, to, { recursive: true })
  process.stdout.write(`  ✓ ${to.replace(ROOT + '/', '')}\n`)
}

process.stdout.write('\nBundle desktop prêt.\n')
