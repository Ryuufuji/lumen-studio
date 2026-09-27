/**
 * Publie une version, puis VÉRIFIE que la mise à jour automatique pourra
 * réellement fonctionner.
 *
 *   LUMEN_GITHUB_OWNER=… LUMEN_GITHUB_REPO=… node scripts/release.mjs
 *
 * Pourquoi un script plutôt qu'une ligne dans package.json ? Parce que la
 * publication échoue SILENCIEUSEMENT quand elle est mal configurée :
 *
 *   1. electron-builder écrit `owner`/`repo` dans `app-update.yml`, embarqué
 *      dans l'installeur. Un placeholder produit une application qui ne
 *      cherchera jamais de mise à jour — sans le moindre message.
 *   2. Il écrit aussi l'URL de l'asset dans `latest.yml`. Si cette URL ne
 *      correspond pas au nom réel du fichier publié, le client reçoit un 404
 *      au moment de télécharger, c'est-à-dire au pire moment.
 *
 * Les deux sont vérifiés ici, sur les fichiers réellement produits. C'est la
 * seule chose qui distingue « ça a construit » de « les clients pourront
 * mettre à jour ».
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE = join(ROOT, 'release')

const owner = process.env.LUMEN_GITHUB_OWNER
const repo = process.env.LUMEN_GITHUB_REPO

/* -------------------------------------------------------------------------
 * 1. Environnement
 * ---------------------------------------------------------------------- */

if (!owner || !repo) {
  process.stderr.write(
    'LUMEN_GITHUB_OWNER et LUMEN_GITHUB_REPO sont obligatoires pour publier.\n' +
      'Sans elles, les clients installeraient l\'application sans jamais\n' +
      'recevoir les versions suivantes.\n',
  )
  process.exit(1)
}

process.stdout.write(`→ Publication vers ${owner}/${repo}\n`)

/* -------------------------------------------------------------------------
 * 2. Reconstruction de l'application
 * ---------------------------------------------------------------------- */

/**
 * On reconstruit TOUJOURS avant d'empaqueter.
 *
 * electron-builder ne sait pas construire l'application : il ne fait que
 * ramasser ce qui se trouve déjà dans `.next/standalone`. Sans cette étape,
 * `npm run release` publiait tel quel le bundle de la dernière fois — potentiellement
 * des semaines plus vieux, et sans aucun lien avec les sources commitées.
 * C'est un piège silencieux : tout paraît fonctionner, et les utilisateurs
 * reçoivent du code que personne ne croyait envoyer.
 */
const prepare = spawnSync('npm', ['run', 'desktop:prepare'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
  shell: false,
})

if (prepare.status !== 0) {
  process.stderr.write('\n✗ Reconstruction échouée : release annulée.\n')
  process.exit(prepare.status ?? 1)
}

/* -------------------------------------------------------------------------
 * 3. Empaquetage, avec les vraies valeurs injectées
 * ---------------------------------------------------------------------- */

const build = spawnSync(
  'npx',
  [
    'electron-builder',
    `--config.publish.provider=github`,
    `--config.publish.owner=${owner}`,
    `--config.publish.repo=${repo}`,
    ...process.argv.slice(2),
  ],
  { cwd: ROOT, stdio: 'inherit', env: process.env, shell: false },
)

if (build.status !== 0) {
  process.stderr.write('\n✗ Construction échouée : release annulée.\n')
  process.exit(build.status ?? 1)
}

/* -------------------------------------------------------------------------
 * 4. Vérifications
 * ---------------------------------------------------------------------- */

const problems = []

/** Les dossiers dépaquetés contiennent l'app-update.yml réellement embarqué. */
for (const dir of ['win-unpacked', 'linux-unpacked', 'mac']) {
  const configPath = join(RELEASE, dir, 'resources', 'app-update.yml')
  if (!existsSync(configPath)) continue

  const text = readFileSync(configPath, 'utf8')
  if (text.includes('__CONFIGUREZ-MOI__')) {
    problems.push(
      `${dir}/resources/app-update.yml contient encore le placeholder : ` +
        `les clients ne trouveront aucune mise à jour.`,
    )
  }
  if (!text.includes(`owner: ${owner}`) || !text.includes(`repo: ${repo}`)) {
    problems.push(`${dir}/resources/app-update.yml ne pointe pas vers ${owner}/${repo}.`)
  }
}

/** Les manifests `latest*.yml` doivent décrire des fichiers existants, exacts. */
for (const manifest of ['latest.yml', 'latest-linux.yml', 'latest-mac.yml']) {
  const path = join(RELEASE, manifest)
  if (!existsSync(path)) continue

  const text = readFileSync(path, 'utf8')
  const entries = [...text.matchAll(/url:\s*(\S+)[\s\S]*?sha512:\s*(\S+)/g)]

  if (entries.length === 0) {
    problems.push(`${manifest} ne décrit aucun fichier.`)
    continue
  }

  for (const [, url, sha512] of entries) {
    const file = join(RELEASE, url)
    if (!existsSync(file)) {
      // Le piège classique : l'URL annoncee ne correspond pas au nom publié.
      const similar = readdirSync(RELEASE).filter((name) =>
        name.replace(/[^a-z0-9.]/gi, '-') === url,
      )
      problems.push(
        similar.length > 0
          ? `${manifest} annonce « ${url} », mais le fichier produit s'appelle ` +
            `« ${similar[0]} ». Un client téléchargerait un 404.`
          : `${manifest} annonce « ${url} », fichier absent de release/.`,
      )
      continue
    }

    const actual = createHash('sha512').update(readFileSync(file)).digest('base64')
    if (actual !== sha512) {
      problems.push(`${manifest} : sha512 incorrect pour ${url}.`)
    }
  }
}

if (problems.length > 0) {
  process.stderr.write('\n✗ Publication ANNULÉE — la mise à jour automatique serait cassée :\n\n')
  for (const problem of problems) process.stderr.write(`   · ${problem}\n`)
  process.stderr.write('\n')
  process.exit(1)
}

process.stdout.write('\n✓ Artefacts et métadonnées de mise à jour cohérents.\n')
process.stdout.write('  Vérifiez maintenant que les fichiers sont bien uploadés sur la\n')
process.stdout.write(`  release GitHub ${owner}/${repo} avant de diffuser.\n`)

/**
 * La publication elle-même est volontairement faite à la main :
 * `electron-builder --publish always`.upload GitHub requires un jeton, et
 * l'écrire dans un dépôt est une action difficile à défaire. Lancer :
 *
 *   npx electron-builder --publish always \
 *     --config.publish.owner=$LUMEN_GITHUB_OWNER \
 *     --config.publish.repo=$LUMEN_GITHUB_REPO
 */
