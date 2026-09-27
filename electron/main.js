/**
 * Processus principal Electron.
 *
 * Architecture retenue : le serveur Next.js embarqué écoute sur un PORT FIXE
 * (127.0.0.1:3210) et la fenêtre charge `http://127.0.0.1:3210`.
 *
 * Pourquoi ne pas faire un export statique en `file://` ? Parce que
 * l'application repose sur deux choses qu'un export statique casse :
 *   1. le middleware Next, qui rafraîchit le cookie de session Supabase ;
 *   2. les cookies de session, qui sont refusés sur l'origine `file://`.
 *
 * Pourquoi un port FIXE et non un port libre ? Parce que l'origine fait
 * partie de l'identité du cookie de session. Un port aléatoire changerait
 * l'origine à chaque lancement, donc les sessions ne survivraient pas et
 * les redirections OAuth ne seraient jamais autorisées. 3210 est donc
 * réservé : voir README pour la configuration Supabase correspondante.
 *
 * Pourquoi `localhost` et pas `127.0.0.1` ? Next.js ne fait PAS confiance à
 * l'en-tête Host (`trustHostHeader: false` par défaut) : le middleware
 * reconstruit toujours les redirections sur le nom d'hôte du serveur, donc
 * `http://localhost:<port>`. Si la fenêtre chargeait 127.0.0.1, la première
 * redirection changerait l'origine, les cookies de session ne suivraient pas
 * et l'allowlist OAuth du projet Supabase devrait contenir DEUX origines.
 * En chargeant directement `localhost`, une seule origine circule de bout en
 * bout — et l'upstream reste la seule URL à autoriser.
 */

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const updater = require('./updater')

const PORT = Number(process.env.LUMEN_PORT || 3210)
const HOST = 'localhost'
const DEV_URL = process.env.ELECTRON_DEV_URL || 'http://localhost:3000'
const IS_DEV = !app.isPackaged

/**
 * Racine du serveur Next.
 *
 * En production il est posé dans `resources/server` (et non dans l'asar) par
 * la section `extraResources` du fichier electron-builder : un serveur Node
 * qui charge ses propres modules depuis une archive bute sur ce que le shim
 * fs d'Electron ne couvre pas. Voir electron/builder.yml.
 */
const SERVER_ROOT = IS_DEV
  ? path.join(__dirname, '..')
  : path.join(process.resourcesPath, 'server')

/** Origine de l'application empaquetée, utilisée pour autoriser la navigation. */
const APP_ORIGIN = `http://${HOST}:${PORT}`

/**
 * En sortie de journal, seulement si le process en a un. Une application
 * Windows empaquetée est en sous-système graphique : `process.stdout` y est
 * absent, et écrire dedans lève.
 */
function log(prefix, chunk) {
  const stream = process.stdout
  if (!stream || typeof stream.write !== 'function') return
  try {
    stream.write(`${prefix}${chunk}`)
  } catch {
    // Un stdout fermé ne doit pas faire tomber l'application.
  }
}

let mainWindow = null
let serverProcess = null
let quitting = false

/* ==========================================================================
 * Serveur Next embarqué
 * ========================================================================== */

function startServer() {
  if (IS_DEV) return Promise.resolve(DEV_URL)

  const entry = path.join(SERVER_ROOT, 'server.js')
  if (!fs.existsSync(entry)) {
    throw new Error(
      `Serveur introuvable : ${entry}\n` +
        `Lancez « npm run desktop:prepare » avant de construire l'application.`,
    )
  }

  serverProcess = spawn(process.execPath, [entry], {
    // `ELECTRON_RUN_AS_NODE` fait tourner Node pur : le process principal ne
    // doit pas initialiser Electron dans le serveur.
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOSTNAME: HOST,
      HOST,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  serverProcess.stdout.on('data', (chunk) => log('[next] ', chunk))
  serverProcess.stderr.on('data', (chunk) => log('[next!] ', chunk))

  // Un serveur qui meurt au démarrage est le symptôme le plus fréquent d'un
  // port déjà occupé (une instance précédente mal arrêtée). `waitForServer`
  // interrogerait alors l'ancien serveur, qui n'est pas la bonne version :
  // on veut donc entendre la mort du process AVANT de considérer le port
  // comme répondant.
  const exited = new Promise((resolve, reject) => {
    serverProcess.on('exit', (code, signal) => {
      const reason = code === null || code === 0 ? `signal ${signal}` : `code ${code}`
      reject(
        new Error(
          `Le serveur interne s'est arrêté au démarrage (${reason}).` +
            (reason === 'code 1'
              ? `\nLe port ${PORT} est probablement déjà utilisé par une autre ` +
                `instance de Lumen Studio : fermez-la, ou choisissez un autre ` +
                `port avec LUMEN_PORT=<port>.`
              : ''),
        ),
      )
    })
  })
  // Si `waitForServer` gagne la course, `exited` restera en attente puis
  // rejtera à la mort du serveur : sans ce rattrapage, ce serait un rejet
  // non géré, qui termine le process principal.
  exited.catch(() => {})

  serverProcess.on('exit', (code) => {
    serverProcess = null
    // Un arrêt inattendu du serveur = application inutilisable : on ferme.
    if (!quitting) {
      dialog.showErrorBox('Lumen Studio', `Le serveur interne s'est arrêté (code ${code}).`)
      app.quit()
    }
  })

  return Promise.race([waitForServer(`http://${HOST}:${PORT}`, 30_000), exited])
}

/** Attend que le serveur réponde, en évitant une course au démarrage. */
function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume()
        resolve(url)
      })

      request.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`Le serveur n'a pas répondu sur ${url} après ${timeoutMs} ms.`))
          return
        }
        setTimeout(attempt, 200)
      })
      request.setTimeout(2000, () => request.destroy())
    }

    attempt()
  })
}

function stopServer() {
  quitting = true
  if (!serverProcess) return
  serverProcess.kill()
  serverProcess = null
}

/* ==========================================================================
 * Fenêtre
 * ========================================================================== */

/**
 * Une URL reste dans la fenêtre applicative ; tout le reste part dans le
 * navigateur du système.
 *
 * La comparaison se fait sur l'ORIGINE, pas sur un simple préfixe de
 * `startsWith` : une cible comme `http://localhost:3210.evil.example`
 * commencerait par la même chaîne et ouvrirait une page tierce DANS la
 * fenêtre, avec accès au contexte de l'application.
 */
function isInternal(target) {
  try {
    const { origin } = new URL(target)
    return origin === APP_ORIGIN || origin === new URL(DEV_URL).origin
  } catch {
    return false
  }
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#08090b',
    title: 'Lumen Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Le moteur WebGL tourne dans le renderer : on ne lui donne aucun
      // accès à Node. C'est ce qui permet d'exécuter du contenu distant
      // (une LUT importée, une photo) sans surface d'attaque.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Toute navigation vers l'extérieur part dans le navigateur du système,
  // jamais dans la fenêtre applicative.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isInternal(target)) return { action: 'allow' }
    void shell.openExternal(target)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (isInternal(target)) return
    event.preventDefault()
    void shell.openExternal(target)
  })

  void mainWindow.loadURL(url)
}

/* ==========================================================================
 * Cycle de vie
 * ========================================================================== */

// Une seule instance : la deuxième est renvoyée vers la première, sinon deux
// serveurs se disputeraient le port 3210.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

// Le bac à sable Chromium n'apporte rien à une app qui n'utilise que WebGL,
// et il casse la sortie vidéo. On le désactive sur macOS uniquement.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'calculateNativeWinOcclusion')
}

app.whenReady().then(async () => {
  try {
    const url = await startServer()
    createWindow(url)
    // La mise à jour tourne en tâche de fond : aucun moment de l'interface
    // n'est bloqué, et l'installation n'a lieu qu'à la fermeture.
    updater.start()
  } catch (error) {
    dialog.showErrorBox('Lumen Studio — démarrage impossible', String(error))
    app.quit()
  }
})

app.on('window-all-closed', () => {
  stopServer()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  updater.stop()
  stopServer()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverProcess) {
    createWindow(`http://${HOST}:${PORT}`)
  }
})

/* ==========================================================================
 * IPC — le renderer ne parle qu'à travers ce canal
 * ========================================================================== */

ipcMain.handle('lumen:info', () => ({
  platform: process.platform,
  version: app.getVersion(),
  electron: process.versions.electron,
  isPackaged: app.isPackaged,
}))

ipcMain.handle('lumen:open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url)
})

ipcMain.handle('lumen:check-for-updates', () => updater.checkNow())

module.exports = { startServer, waitForServer, PORT, HOST }
