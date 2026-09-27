import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
})

/**
 * ESLint 9 exige une configuration « plate ». `eslint-config-next` est encore
 * distribué au format classique, d'où le pont FlatCompat.
 *
 * On ne lint que le code applicatif : `electron/` est du Node CommonJS que
 * les règles orientées React/Next ne savent pas comprendre, et il est déjà
 * couvert par `node --check`.
 */
export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'release/**',
      'dist/**',
      'next-env.d.ts',
      'supabase/**',
      // Le processus principal Electron est du CommonJS, obligatoirement :
      // un précharge en bac à sable ne peut pas utiliser `import`, et le
      // process principal n'est pas bundlé par Next. La règle
      // `no-require-imports` s'y applique donc à contresens. Ces fichiers
      // restent couverts par `node --check`.
      'electron/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Les shaders GLSL vivent dans des template literals : `no-useless-escape`
      // et `no-template-curly-in-string` n'ont aucun sens ici.
      'react/no-unescaped-entities': 'off',
    },
  },
]
