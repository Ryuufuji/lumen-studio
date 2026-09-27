/**
 * Typage du pont exposé par electron/preload.js.
 *
 * Le renderer n'a pas accès à Node : il ne voit que ce que le précharge a
 * explicitement exposé sur `window.lumen`. Ce fichier décrit exactement cette
 * surface — et surtout ce qu'elle ne contient pas.
 *
 * `lumen` est OPTIONNEL (`?`) : la même application tourne dans un navigateur,
 * où le précharge n'existe pas. Tout appel doit donc passer par
 * `src/lib/desktop.ts`, qui dégrade proprement.
 */

/** Cycle de vie d'une mise à jour, tel que résumé par electron/updater.js. */
export type UpdateState =
  /** Rien à faire, ou vérification terminée sans nouveau version. */
  | 'idle'
  /** Requête en cours vers le serveur de publication. */
  | 'checking'
  /** Téléchargement en cours : `percent` renseigne l'avancement. */
  | 'downloading'
  /** Téléchargée. Installée au prochain arrêt, jamais en cours d'édition. */
  | 'ready'
  /** Échec réseau ou miroir indisponible : sans conséquence sur l'éditeur. */
  | 'error'
  /** Application non empaquetée : pas de mise à jour possible (dev). */
  | 'unsupported'

export interface UpdateStatus {
  state: UpdateState
  /** Version cible, connue à partir de `update-available`. */
  version?: string
  /** Avancement du téléchargement, 0–100. */
  percent?: number
  /** Message d'erreur, pour le journal de bord. */
  message?: string
}

export interface DesktopInfo {
  platform: NodeJS.Platform
  version: string
  electron: string
  isPackaged: boolean
}

export interface LumenBridge {
  /** Informations de la plateforme, pour adapter l'interface. */
  info(): Promise<DesktopInfo>
  /** Ouvre une URL hors application dans le navigateur du système. */
  openExternal(url: string): Promise<void>
  /** Vérification immédiate, hors périodique. */
  checkForUpdates(): Promise<UpdateStatus>
  /**
   * Abonne le renderer au statut de mise à jour.
   * Le retour est une fonction de désabonnement, à appeler dans un
   * `useEffect` — sinon l'écouteur fuit et `ipcRenderer` retient le
   * composant démonté.
   */
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void
}

declare global {
  interface Window {
    lumen?: LumenBridge
  }
}

export {}
