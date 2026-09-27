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

import { cp, access, rm, readdir } from 'node:fs/promises'
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

/* ==========================================================================
 * Retire la chaîne de traitement d'images côté serveur
 * ==========================================================================
 *
 * `next build` produit la chaîne native `sharp` de la machine qui compile. En
 * cross-build, l'installeur Windows se retrouvait donc à embarquer des
 * binaires `.node` compilés pour Linux — 18 Mo de code mort, et surtout une
 * bombe latente : le moindre appel à l'optimiseur d'images de Next échouerait
 * sur Windows avec une erreur illisible.
 *
 * L'application n'a besoin d'aucun traitement d'image côté serveur : la
 * retouche est 100 % GPU, et `next.config.mjs` fixe `images.unoptimized`.
 * Vérifié : le serveur démarre et répond normalement sans cette chaîne.
 *
 * ⚠ Ce retrait est COUPLÉ à `images.unoptimized: true`. Réactiver
 * l'optimiseur d'images de Next obligerait à réintroduire sharp, et à
 * reconstruire le standalone sur la plateforme cible — un `next build`
 * Linux ne produit jamais des binaires Windows.
 */

const NATIVE_IMAGE_PACKAGES = ['sharp', '@img']

async function stripNativeImageToolchain(root) {
  for (const name of NATIVE_IMAGE_PACKAGES) {
    const dir = join(root, 'node_modules', name)
    if (!(await exists(dir))) continue
    const entries = await readdir(dir)
    await rm(dir, { recursive: true, force: true })
    process.stdout.write(
      `  ✓ retiré node_modules/${name} (${entries.length} entrées, chaîne image native)\n`,
    )
  }
}

const before = process.hrtime.bigint()
await stripNativeImageToolchain(STANDALONE)
const ms = Number(process.hrtime.bigint() - before) / 1e6

if (ms > 0) {
  process.stdout.write(`  (${ms.toFixed(0)} ms)\n`)
}
