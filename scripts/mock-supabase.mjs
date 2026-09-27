/**
 * Serveur de test imitant l'API d'authentification Supabase.
 *
 *   node scripts/mock-supabase.mjs
 *
 * Pourquoi : tester le code d'authentification de l'application exige un
 * backend qui parle le protocole de Supabase. Sans projet réel, la seule
 * alternative est de ne rien tester du tout — et un formulaire de connexion
 * n'est pas du code qu'on peut supposer correct.
 *
 * CE QUE CELA NE TESTE PAS : le comportement de Supabase lui-même. C'est un
 * double de test, pas un émulateur. Un test vert ici signifie « notre code
 * envoie les bonnes requêtes et traite les bonnes réponses », pas
 * « l'authentification fonctionne en production ».
 *
 * Le port 54321 est choisi exprès : c'est l'adresse du stack local
 * (`npx supabase start`), celle que `.env.local` référence déjà. Aucun
 * rebuild n'est nécessaire pour tester.
 */

import { createServer } from 'node:http'

const PORT = 54321
const HOST = '127.0.0.1'

/** Comptes mémorisés pendant la session du serveur. */
const accounts = new Map()

/** Encode un JWT factice : supabase-js en décode la charge utile. */
function fakeJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature-factice`
}

function sessionFor(user) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  return {
    access_token: fakeJwt({
      sub: user.id,
      email: user.email,
      role: 'authenticated',
      aud: 'authenticated',
      exp: expiresAt,
    }),
    refresh_token: `refresh-${user.id}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
  }
}

function readBody(request) {
  return new Promise((resolve) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
  })
}

function send(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    // `x-supabase-api-version` est envoyé par supabase-js depuis la 2.47 :
    // l'oublier fait échouer le préflight, et la requête n'atteint jamais
    // le serveur. discovered en testant, pas en relisant.
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '600',
  })
  response.end(payload)
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, {})

  const url = new URL(request.url, `http://${HOST}:${PORT}`)

  // Le client appelle /auth/v1/... ; certaines installations préfixent /v1.
  const path = url.pathname.replace(/^\/(auth\/)?v1/, '')

  process.stdout.write(`  ${request.method} ${url.pathname}\n`)

  // GET /user — utilisé par le middleware pour rafraîchir la session
  if (request.method === 'GET' && path === '/user') {
    const token = (request.headers.authorization ?? '').replace(/^Bearer /, '')
    if (!token) return send(response, 401, { message: 'invalid token' })
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    )
    return send(response, 200, {
      id: payload.sub,
      aud: 'authenticated',
      role: 'authenticated',
      email: payload.email,
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: new Date().toISOString(),
    })
  }

  // POST /signup
  if (request.method === 'POST' && path === '/signup') {
    const { email, password } = await readBody(request)
    if (!email || !password) {
      return send(response, 422, {
        message: 'Unable to validate email address: invalid format',
      })
    }
    if (password.length < 8) {
      return send(response, 422, {
        message: 'Password should be at least 8 characters',
      })
    }
    if (accounts.has(email)) {
      return send(response, 422, {
        message: 'User already registered',
        error_code: 'user_already_exists',
      })
    }
    const user = {
      id: `user-${accounts.size + 1}`,
      email,
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: new Date().toISOString(),
    }
    accounts.set(email, { user, password })
    // Les champs de session arrivent À PLAT, à côté de `user` — pas
    // imbriqués sous une clé `session`. `_sessionResponse` teste
    // `data.access_token` ; une réponse `{ user, session }` lui ferait croire
    // qu'aucune session n'a été émise, et l'application afficherait à tort
    // « un e-mail de confirmation vous a été envoyé ».
    return send(response, 200, { ...sessionFor(user), user })
  }

  // POST /token?grant_type=password  OU  grant_type=refresh_token
  //
  // supabase-js nulnerie jamais la session telle quelle : après un signup
  // ou une connexion, `signUp` appelle `_recoverAndRefresh`, qui rejoue un
  // `grant_type=refresh_token`. Sans cette route, la récupération échoue et
  // `data.session` arrive `null` — l'application croit alors qu'un e-mail de
  // confirmation est necessaire, a tort.
  if (request.method === 'POST' && path === '/token') {
    const { email, password, refresh_token } = await readBody(request)
    const grant = url.searchParams.get('grant_type')

    if (grant === 'refresh_token') {
      const known = [...accounts.values()].find(
        (account) => account.user.id === String(refresh_token).replace(/^refresh-/, ''),
      )
      if (!known) {
        return send(response, 400, {
          error: 'invalid_grant',
          error_description: 'Invalid Refresh Token',
        })
      }
      return send(response, 200, { ...sessionFor(known.user), user: known.user })
    }

    const known = accounts.get(email)
    if (!known || known.password !== password) {
      return send(response, 400, {
        error: 'invalid_grant',
        error_description: 'Invalid login credentials',
      })
    }
    // `user` accompagne la session : `signInWithPassword` exige les deux, et
    // lève « Auth session or user missing » si l'un manque.
    return send(response, 200, { ...sessionFor(known.user), user: known.user })
  }

  // POST /logout
  if (request.method === 'POST' && path === '/logout') {
    return send(response, 204, {})
  }

  send(response, 404, { message: `Aucune route pour ${request.method} ${path}` })
})

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `✓ Supabase de test sur http://${HOST}:${PORT} (Ctrl+C pour arrêter)\n`,
  )
})
