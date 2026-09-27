/**
 * Mise à jour automatique, en arrière-plan et sans fenêtre.
 *
 * Le principe : on ne demande jamais à l'utilisateur de valider quoi que ce
 * soit. `electron-updater` télécharge la nouvelle version en silence et
 * l'installe au moment de la fermeture de l'application — donc jamais au
 * milieu d'une retouche. Le renderer reçoit juste un statut qu'il peut
 * afficher discrètement, ou ignorer.
 *
 * Ce que ça ne fait PAS, volontairement :
 *  - pas de téléchargement depuis un code arbitraire (signature vérifiée par
 *    electron-updater via la checksum publiée avec la release) ;
 *  - pas de mise à jour depuis un binaire non signé.
 */

const { autoUpdater } = require('electron-updater')
const { BrowserWindow, app } = require('electron')
const { appendFileSync, statSync } = require('node:fs')
const path = require('node:path')

/** Toutes les 6 h : assez rare pour ne pas traffiquer, assez souvent pour
 *  que la propagation prenne quelques jours. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let timer = null
let wired = false
/** electron-updater lève si on relance une vérification pendant la précédente :
 *  sans ce drapeau, le timer de 6 h ferait planter l'app. */
let checking = false

function publish(payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('lumen:update-status', payload)
    }
  }
}/** Au-delà, on cesse d'écrire : un fichier de log ne doit pas grossir sans
 *  borne chez un utilisateur qui laisse l'application des mois en arrière-plan. */
const LOG_MAX_BYTES = 256 * 1024

/**
 * Journal de l'updater vers un FICHIER, jamais vers la console.
 *
 * electron-updater accepte n'importe quel objet `{ info, warn, error, debug }`.
 * On ne lui fournit volontairement pas `console` (son défaut) : un miroir
 * indisponible déverserait alors une pile d'appels complète dans la sortie
 * standard, ce qui est précisément le bruit que « mise à jour invisible »
 * veut éviter. Le fichier, lui, reste consultable quand un utilisateur se
 * demande pourquoi l'application ne s'est pas mise à jour.
 */
function createLogger(file) {
  const write = (level, message) => {
    try {
      const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0
      if (size > LOG_MAX_BYTES) return
      appendFileSync(file, `${new Date().toISOString()} [${level}] ${message}\n`)
    } catch {
      // Un journal ne doit jamais faire échouer une mise à jour.
    }
  }

  return {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
    debug: () => {},
  }
}

/** Traduit les événements d'electron-updater en un statut unique. */
function wire() {
  // Idempotent : `start()` puis `checkNow()` ne doivent pas doubler les
  // écouteurs, sinon le renderer recevrait chaque statut deux fois.
  if (wired) return
  wired = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = createLogger(path.join(app.getPath('userData'), 'updater.log'))

  autoUpdater.on('checking-for-update', () => publish({ state: 'checking' }))

  autoUpdater.on('update-available', (info) => {
    publish({ state: 'downloading', version: info.version })
  })

  autoUpdater.on('update-not-available', () => publish({ state: 'idle' }))

  autoUpdater.on('download-progress', (progress) => {
    publish({ state: 'downloading', percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    // Installée au prochain arrêt : on ne coupe jamais une retouche en cours.
    publish({ state: 'ready', version: info.version })
  })

  autoUpdater.on('error', (error) => {
    // Une erreur réseau ou un miroir indisponible ne doit jamais faire
    // planter l'éditeur : on se contente de ne pas mettre à jour.
    publish({ state: 'error', message: String(error?.message ?? error) })
  })
}

/**
 * Lance une vérification.
 *
 * Toujours résolue : le renderer ne doit pas avoir à traiter un rejet, et une
 * panne du service de mise à jour ne doit pas remonter en exception non
 * gérée dans le process principal (ce qui fermerait l'application).
 *
 * @returns {Promise<{state: string, version?: string, message?: string}>}
 */
async function checkNow() {
  if (!app.isPackaged) {
    // electron-updater ne fonctionne pas depuis le code non empaqueté :
    // `app-update.yml` n'existe pas et le module lève au premier appel.
    const status = { state: 'unsupported' }
    publish(status)
    return status
  }

  wire()

  if (checking) return { state: 'checking' }
  checking = true

  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result) return { state: 'idle' }
    if (result.updateInfo && !result.downloadPromise) {
      return { state: 'idle', version: result.updateInfo.version }
    }
    return { state: 'downloading', version: result.updateInfo?.version }
  } catch (error) {
    const message = String(error?.message ?? error)
    publish({ state: 'error', message })
    return { state: 'error', message }
  } finally {
    checking = false
  }
}

function start() {
  if (!app.isPackaged) {
    publish({ state: 'unsupported' })
    return
  }

  void checkNow()

  timer = setInterval(() => {
    void checkNow()
  }, CHECK_INTERVAL_MS)
  // Ne pas maintenir le process en vie juste pour ça.
  timer.unref?.()
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { start, stop, checkNow, CHECK_INTERVAL_MS }
