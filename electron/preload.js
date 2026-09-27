/**
 * Précharge — le seul pont entre le renderer et Node.
 *
 * Le renderer est une application web classique : il ne doit jamais voir
 * `require`, `process` ou le système de fichiers. On n'expose donc que ce
 * dont l'interface a réellement besoin — quatre méthodes, pas plus.
 */

const { contextBridge, ipcRenderer } = require('electron')

/**
 * @param {string} channel
 * @returns {(...args: unknown[]) => Promise<unknown>}
 */
const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('lumen', {
  /** Informations de la plateforme, pour adapter l'UI. */
  info: invoke('lumen:info'),

  /** Ouvre une URL hors application dans le navigateur du système. */
  openExternal: invoke('lumen:open-external'),

  /**
   * Vérification immédiate, hors périodique. Le process principal répond
   * toujours (il dégrade en `{ state: 'unsupported' }` hors paquet) : le
   * renderer n'a donc jamais à traiter un rejet.
   */
  checkForUpdates: invoke('lumen:check-for-updates'),

  /**
   * Abonne le renderer au statut de mise à jour.
   * Le retour est une fonction de désabonnement, comme un `useEffect`.
   */
  onUpdateStatus(callback) {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lumen:update-status', listener)
    return () => ipcRenderer.removeListener('lumen:update-status', listener)
  },
})
