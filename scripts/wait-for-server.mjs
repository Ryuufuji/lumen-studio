/**
 * Attend qu'un serveur HTTP réponde avant de lancer quoi que ce soit.
 *
 *   node scripts/wait-for-server.mjs http://127.0.0.1:3000
 *
 * Utilisé par `npm run desktop:dev` : sans cela, Electron démarrerait avant
 * Next et afficherait « connection refused » sur une fenêtre qu'il faut
 * fermer à la main.
 */

import http from 'node:http'

const target = process.argv[2] || 'http://127.0.0.1:3000'
const timeoutMs = Number(process.argv[3] || 60_000)
const deadline = Date.now() + timeoutMs

function attempt() {
  const request = http.get(target, (response) => {
    response.resume()
    process.stdout.write(`✓ ${target} répond\n`)
    process.exit(0)
  })

  request.on('error', () => {
    if (Date.now() > deadline) {
      process.stderr.write(`✗ ${target} n'a pas répondu après ${timeoutMs} ms\n`)
      process.exit(1)
    }
    setTimeout(attempt, 250)
  })

  request.setTimeout(2000, () => request.destroy())
}

attempt()
