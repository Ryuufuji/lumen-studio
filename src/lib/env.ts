/**
 * Lecture centralisée et typée des variables d'environnement.
 * On échoue tôt et bruyamment plutôt que de planter plus tard dans un composant.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `[lumen] Variable d'environnement manquante : ${name}. ` +
        `Copiez .env.example vers .env.local puis renseignez-la.`,
    )
  }
  return value
}

const supabaseUrl = required(
  'NEXT_PUBLIC_SUPABASE_URL',
  process.env.NEXT_PUBLIC_SUPABASE_URL,
)
const supabaseAnonKey = required(
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  isLocal: supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost'),
} as const

/** Types de buckets, alignés sur la migration 0003. */
export const STORAGE_BUCKETS = {
  photos: 'photos',
  exports: 'exports',
  lutFiles: 'lut-files',
  luts: 'luts',
  avatars: 'avatars',
} as const

export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS]
