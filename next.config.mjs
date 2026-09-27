/** @type {import('next').NextConfig} */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url))

const nextConfig = {
  reactStrictMode: true,
  // Bundle autonome pour Electron : le serveur embarqué n'a besoin ni de
  // `node_modules` ni du dossier du projet. `npm run desktop:prepare`
  // complete ensuite avec `.next/static` et `public/`.
  output: 'standalone',
  // Next devine sinon la racine du workspace en remontant jusqu'au premier
  // lockfile trouvé — ici `~/package-lock.json`, au-dessus du projet. Pour le
  // build standalone, cette racine borne ce qui est recopié dans le bundle :
  // la fixer évite un bundle qui traîne des fichiers étrangers.
  outputFileTracingRoot: PROJECT_ROOT,
  // Electron charge l'app via http://127.0.0.1:3210, pas via un chemin de
  // fichiers : les images ne doivent donc pas être optimisées en AVIF/WebP,
  // que le protocole file:// ne sait pas lire de toute façon.
  images: {
    unoptimized: true,
  },
  // Les textures de sortie (WebGL -> canvas -> blob) sont générées côté client.
  experimental: {
    optimizePackageImports: ['lucide-react', 'fabric'],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // glslify : permet d'importer des shaders .glsl avec #include
      config.module.rules.push({
        test: /\.(glsl|vert|frag)$/,
        type: 'asset/source',
        generator: { filename: 'static/shaders/[name][ext]' },
      });
    }
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Requis pour SharedArrayBuffer / timers haute précision du pipeline WebGL.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
      {
        // electron-builder telecharge ses metadonnees de mise a jour sur son
        // propre serveur : des en-tetes Cross-Origin strictes l'empecheraient
        // de lire la reponse. On les relache uniquement sur /luts, qui est
        // du contenu statique sans consequence de securite.
        source: '/luts/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'unsafe-none' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none' },
        ],
      },
    ];
  },
}

export default nextConfig
