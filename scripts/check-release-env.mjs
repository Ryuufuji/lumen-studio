/**
 * Vérifie que l'environnement de publication GitHub est complet.
 *
 *   node scripts/check-release-env.mjs
 *
 * Pourquoi une garde ? Parce que l'échec est SILENCIEUX du côté client : sans
 * `owner`/`repo`, electron-updater ne trouve simplement aucune release, la
 * mise à jour automatique ne se produit jamais, et rien ne signale le problème
 * à l'utilisateur. Mieux vaut que la publication échoue bruyamment, ici,
 * avant de fabriquer un installeur que personne ne pourra mettre à jour.
 */

const REQUIRED = ['LUMEN_GITHUB_OWNER', 'LUMEN_GITHUB_REPO']

const missing = REQUIRED.filter((name) => {
  const value = process.env[name]
  return typeof value !== 'string' || value.trim() === ''
})

if (missing.length > 0) {
  process.stderr.write(
    'Publication impossible : variable(s) d\'environnement manquante(s)\n' +
      missing.map((name) => `  · ${name}`).join('\n') +
      '\n\n' +
      'Sans elles, electron-updater cherche les releases à une adresse vide :\n' +
      'les clients installent l\'application mais ne reçoivent jamais la\n' +
      'version suivante, sans aucun message.\n\n' +
      'Renseignez-les pour la session courante :\n\n' +
      '  export LUMEN_GITHUB_OWNER=<votre-organisation>\n' +
      '  export LUMEN_GITHUB_REPO=<votre-depot>\n\n' +
      'Pour un build local simple, `npm run desktop:dist` ne les exige pas —\n' +
      'seule la publication les utilise.\n',
  )
  process.exit(1)
}

process.stdout.write(
  `✓ Publication → ${process.env.LUMEN_GITHUB_OWNER}/${process.env.LUMEN_GITHUB_REPO}\n`,
)
