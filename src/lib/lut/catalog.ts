/**
 * Catalogue des LUTs système.
 *
 * Le manifeste est produit par `npm run lut:generate` et servi statiquement.
 * On le charge une fois au montage plutôt que de l'embarquer : ajouter une
 * LUT ne demande alors qu'un fichier de plus dans `public/luts/system/`.
 */

export interface CatalogLut {
  slug: string
  name: string
  group: string
  description: string
  author: string
  url: string
  size: number
}

export interface CatalogGroup {
  slug: string
  name: string
  description: string
  icon: string
}

export interface Catalog {
  size: number
  groups: CatalogGroup[]
  luts: CatalogLut[]
}

const CATALOG_URL = '/luts/system/catalog.json'

let cached: Promise<Catalog> | null = null

export function loadCatalog(): Promise<Catalog> {
  // `cache: 'default'` et surtout PAS 'force-cache' : ce manifeste peut
  // avoir été mis en cache alors que le serveur répondait encore par une
  // redirection (le middleware d'auth l'attrapait avant qu'on l'exclue).
  // En mode force, le navigateur rejouerait ce 307 périmé indéfiniment et
  // le navigateur de LUT resterait vide sans la moindre erreur réseau.
  cached ??= fetch(CATALOG_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Catalogue indisponible (${response.status})`)
      return response.json() as Promise<Catalog>
    })
    .catch((error: unknown) => {
      // On ne mémorise pas l'échec : un second appel doit pouvoir réessayer.
      cached = null
      throw error
    })
  return cached
}

export function groupLuts(catalog: Catalog, groupSlug: string): CatalogLut[] {
  return catalog.luts.filter((lut) => lut.group === groupSlug)
}

/**
 * Clé de cache d'une LUT. Sert d'identifiant stable pour le cache GPU ET
 * pour le champ `textureKey` de l'état de l'éditeur : tant que la clé ne
 * change pas, on ne retélécharge ni ne retransmet la texture.
 */
export function textureKeyFor(source: { url?: string; id?: string; size: number }): string {
  return `${source.id ?? source.url ?? 'lut'}:${source.size}`
}
