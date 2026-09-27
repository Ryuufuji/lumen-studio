# Lumen Studio

Éditeur photo web **non destructif** : la gestion de calques de Photoshop, la
colorimétrie de Lightroom, un moteur de rendu WebGL et une photothèque
Supabase — le tout dans le navigateur, sans upload côté serveur pour la
retouche.

> **État actuel : phases 1 à 3 livrées.** Thèmes dynamiques, moteur de rendu
> WebGL2, calques de masque, LUTs 3D, application de bureau Electron avec mise
> à jour automatique. L'authentification Supabase réelle et les phases
> suivantes arrivent ensuite — voir [Feuille de route](#feuille-de-route).

---

## Stack

| Couche | Choix | Rôle |
| --- | --- | --- |
| Framework | **Next.js 15** (App Router, React 19) | Rendu, routes, API |
| Styles | **Tailwind CSS v4** + tokens CSS | Thèmes 100 % à chaud, sans rechargement |
| Auth / Données / Fichiers | **Supabase** (Auth, Postgres, Storage) | Comptes, presets, LUTs, photos |
| Rendu | **WebGL2** (shaders GLSL ES 3.0) | Pipeline de retouche + masques |
| État | **Zustand** | Store éditeur, store UI |
| Validation | **Zod** | Schémas de presets, import de LUTs |

### Pourquoi WebGL2 plutôt que Fabric.js ?

La demande initiale mentionnait « WebGL **ou** un wrapper type glfx/Fabric ».
Le choix retenu est **WebGL2 brut**, pour trois raisons :

1. **Les LUTs 3D exigent unlookup en `sampler3D`.** Aucun wrapper 2D ne sait
   appliquer une `.cube` 33³ correctement et vite.
2. **La précision.** L'objectif est le réglage fin : on travaille en
   `float`/`half-float` avec un espace colorimétrique explicite, ce que le
   pipeline 2D de Fabric ne gère pas.
3. **Les masques sont des textures**, pas des objets vectoriels. Un pinceau qui
   écrit dans un `R8` framebuffer est plus simple et plus rapide qu'un chemin
   vectoriel re-rasterisé.

Fabric reste dans les dépendances pour la **couche d'annotations vectorielles**
(flèches, texte, recadrage) qui, elle, est un vrai cas 2D.

---

## Démarrage

```bash
npm install
cp .env.example .env.local     # renseignez vos clés Supabase

# Option A — backend Supabase local (nécessite Docker)
npx supabase start
npm run supabase:reset         # applique les migrations + le seed

# Option B — projet Supabase existant
# collez l'URL et la clé anon dans .env.local

npm run dev                    # http://localhost:3000
```

Scripts :

| Commande | Effet |
| --- | --- |
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run supabase:start` | Stack locale (Postgres, Auth, Storage, Studio) |
| `npm run supabase:reset` | Rejoue toutes les migrations |
| `npm run supabase:gen-types` | Régénère `src/types/database.generated.ts` |

Scripts d'atelier :

| Commande | Effet |
| --- | --- |
| `npm run lut:generate` | Régénère les 25 LUTs système de `public/luts/system/` |
| `npm run lut:validate` | Vérifie la structure des `.cube` (taille, bornes, nommage) |

---

## Application de bureau (Electron)

L'application se package en **installeur Windows** (`.exe`) et en **AppImage
Linux** (un seul exécutable), avec **mise à jour automatique silencieuse**.

### Construire

```bash
# Linux → AppImage  (~128 Mo, autonome)
npm run desktop:dist:linux

# Windows → installeur .exe  (cross-build depuis Linux via Wine)
npm run desktop:dist:win

# Les deux plateformes d'un coup
npm run desktop:dist
```

Les artefacts atterrissent dans `release/` :

```
release/
├── lumen-studio-0.1.0-x86_64.AppImage   # Linux
├── lumen-studio-0.1.0-setup.exe         # Windows
├── latest-linux.yml                     # métadonnées de mise à jour
└── latest.yml
```

> Les noms d'artefacts ne contiennent **aucun espace**, volontairement :
> electron-builder transforme les espaces en tirets dans l'URL écrite dans
> `latest.yml`, mais publie le fichier sous son vrai nom. Un client
> téléchargerait alors un 404.

### Tester sans empaqueter

```bash
npm run desktop:dev    # Next en dev sur :3000, puis Electron par-dessus
```

### Publier une version (avec mise à jour automatique)

```bash
export LUMEN_GITHUB_OWNER=<votre-organisation>
export LUMEN_GITHUB_REPO=<votre-dépôt>

npm run release        # incrémente la version, construit, puis VÉRIFIE
npm run release:upload # dépose les artefacts sur la release GitHub
```

`npm run release` s'arrête si les deux variables manquent, et **vérifie le
résultat** avant d'aller plus loin :

- que `app-update.yml`, réellement embarqué dans les installeurs, pointe vers
  votre dépôt et non vers un placeholder ;
- que l'URL annoncée dans `latest.yml` correspond bien au nom du fichier
  produit ;
- que le `sha512` annoncé correspond au fichier.

Ces trois vérifications visent le même échec : une publication qui réussit
mais dont **personne ne reçoit la mise à jour**. Rien ne signale ce cas — pas
de message, pas de crash — l'application se contente de ne jamais se mettre à
jour. C'est aussi pour cela que `npm run release:upload` est une commande
séparée et explicite.

### Comment fonctionne la mise à jour

L'exigence est « en arrière-plan, sans rien voir ». Le mécanisme :

| Moment | Ce qui se passe | Ce que voit l'utilisateur |
| --- | --- | --- |
| Au démarrage + toutes les 6 h | Requête vers la dernière release | rien |
| Si nouvelle version | Téléchargement **silencieux** (`autoDownload`) | un point pulsé en bas à droite |
| Une fois téléchargée | Installation **à la fermeture** (`autoInstallOnAppQuit`) | « installé au prochain démarrage » |
| Coupure réseau / panne du miroir | Erreur interceptée, journalisée | **rien** |

Il n'y a **aucune modale**, aucun bouton « Installer maintenant », aucun
délai. Une retouche en cours n'est jamais interrompue : l'installation se
produit quand l'application se ferme.

L'échec est silencieux côté interface, mais **pas** silencieux côté build —
c'est tout l'intérêt de `scripts/release.mjs`.

### Où vivent les dépendances

`package.json` ne liste que `electron-updater` et `electron-log` en
`dependencies`. Tout le reste — Next, React, Supabase, Fabric, Zod — est en
`devDependencies`, et c'est volontaire.

electron-builder recopie automatiquement les `dependencies` dans l'archive
`asar`. Sans cette répartition, l'archive pesait **133 Mo** de doublons, qui
existaient déjà dans `resources/server/node_modules`. Elle pèse maintenant
**1,3 Mo**, et l'AppImage **128 Mo** au lieu de 204 Mo.

### Configuration Supabase pour la version empaquetée

L'application empaquetée écoute sur une **origine fixe** : `http://localhost:3210`.

Ce port est en dur, et c'est volontaire. L'origine fait partie de l'identité du
cookie de session : un port choisi au hasard changerait d'origine à chaque
lancement, donc personne ne resterait connecté et les redirections OAuth
jamais autorisées.

Le nom d'hôte est `localhost` et non `127.0.0.1` pour une raison mesurée :
Next.js ne fait pas confiance à l'en-tête `Host` (`trustHostHeader: false` par
défaut). Si le serveur écoute sur une adresse et que la fenêtre en charge une
autre, le middleware reconstruit ses redirections sur la sienne, et l'origine
change en cours de route : les cookies ne suivent pas, et le projet Supabase
devrait autoriser deux origines. En chargeant la même adresse que celle
écoutée, Next émet une redirection **relative** (`/login?next=…`), qui préserve
l'origine par construction. Une seule origine circule donc de bout en bout.

```bash
# Authentication → URL Configuration
Site URL                    = http://localhost:3210
Additional Redirect URLs    = http://localhost:3210/auth/callback
```

Pour un autre port (deux instances en parallèle, par exemple) :
`LUMEN_PORT=3211 npm run desktop:dev`.

### Sécurité de la fenêtre

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` — le
  renderer n'a **aucun** accès à Node, même s'il affiche une image ou une LUT
  importée dont personne ne contrôle le contenu.
- Toute navigation ou ouverture de fenêtre vers l'extérieur part dans le
  navigateur du système, jamais dans la fenêtre applicative. Le filtrage se
  fait par **origine** : `http://localhost:3210.evil.example` n'ouvre pas de
  page tierce dans la fenêtre de l'application.
- Instance unique : un second lancement réveille la fenêtre existante au lieu
  de démarrer un second serveur sur le même port.
- Si le port 3210 est déjà occupé, l'application **refuse de démarrer** avec un
  message explicite, au lieu de se connecter par hasard à un serveur d'une
  autre version.
- L'archive `asar` ne contient que le code Electron ; le serveur Next est posé
  sur le disque dans `resources/server`. Un serveur Node qui charge ses propres
  modules depuis une archive bute sur ce que le shim fs d'Electron ne couvre
  pas (`fs.watch`, `mmap`, liens symboliques) : sur disque, plus de surprise.

---

## Architecture des dossiers

```
.
├── public/luts/system/        # .cube livrés avec l'app (serveur statique)
├── scripts/                   # outils Node (validation des LUTs, etc.)
├── supabase/
│   ├── config.toml            # stack locale
│   └── migrations/            # 0001 schéma · 0002 RLS · 0003 storage · 0004 seed
└── src/
    ├── app/
    │   ├── (auth)/            # login, signup, callback OAuth
    │   ├── (workspace)/       # editor, presets, gallery, academy
    │   └── api/               # route handlers (export, webhooks IA)
    ├── components/
    │   ├── editor/
    │   │   ├── canvas/        # <-- moteur WebGL (phase 2)
    │   │   ├── tools/         # pinceau, dégradés, eyedropper
    │   │   ├── panels/        # lumière, couleur, détails, courbes
    │   │   └── history/       # undo/redo
    │   ├── lut/               # navigateur, import, dossiers
    │   ├── ai/                # boutons + file d'attente
    │   ├── academy/           # ressources et guides
    │   ├── providers/         # thème, supabase
    │   └── ui/                # primitives (slider, bouton, popover…)
    ├── lib/
    │   ├── gl/                # core WebGL, shaders GLSL, pipeline
    │   ├── lut/               # parseur .cube, Hald, upload
    │   ├── editor/            # schéma Zod, défauts, migrations
    │   ├── presets/           # sauvegarde / chargement
    │   ├── ai/                # adaptateurs de fournisseurs
    │   ├── supabase/          # clients browser / server / middleware
    │   ├── env.ts             # variables d'environnement typées
    │   └── themes.ts          # catalogue des thèmes
    ├── store/                 # Zustand : editor, ui, history
    └── types/                 # database.ts, editor.ts
```

---

## Modèle de données

```
auth.users ──1:1──> profiles
                    ├──< lut_groups >──< luts
                    ├──< projects >──< project_versions
                    │        └──> storage.objects  (bucket photos / exports)
                    ├──< presets
                    ├──< storage_objects          (inventaire + quota)
                    └──< ai_jobs                   (file de traitement)
```

Points clés :

- **Tout est cloisonné par RLS.** Le client parle directement à Supabase avec
  la clé anon : les politiques de `0002_rls.sql` *sont* la sécurité.
- **Les fichiers sont rangés sous `<user_id>/`**, ce qui permet des policies
  Storage d'une ligne (`(storage.foldername(name))[1] = auth.uid()`).
- **Une seule LUT active par utilisateur** garanti par un index unique
  partiel (`luts_single_active_per_user`).
- **`presets.settings` est un `jsonb` versionné** (`schema_version`) : le même
  document que `projects.settings`, validé par Zod et migré au chargement.

---

## Le cœur : `EditorState`

`src/types/editor.ts` définit l'état de l'éditeur. C'est **le** contrat entre
le moteur de rendu, l'UI, la sauvegarde et les presets.

```
EditorState
├── adjustments   17 curseurs bornés (lumière / couleur / détails)
├── hsl           8 bandes réglables individuellement
├── curves        4 courbes (RGB + R, G, B)
├── lut           { id, slug, intensity, format, sourceUrl, textureKey }
├── layers[]      la pile de masques façon Photoshop
├── crop          recadrage normalisé
└── beforeAfter   comparateur avant / après
```

Trois invariants garantis par le typage :

1. **100 % sérialisable en JSON.** C'est exactement ce qui part dans la base.
2. **Aucune donnée binaire.** Les masques peints vivent dans des textures GPU
   identifiées par `maskTextureKey`, pas dans le document.
3. **Versionné.** `EDITOR_STATE_VERSION` + un migreur par version : un preset
   enregistré il y a six mois se recharge sans casser.

Les bornes de chaque curseur sont déclarées **une seule fois** dans
`ADJUSTMENT_SPECS` (`src/lib/editor/schema.ts`). L'UI, la validation Zod et la
normalisation GLSL vers `[0,1]` lisent la même table — impossible d'avoir un
slider qui accepte -120 alors que le shader sature à 100.

---

## Pipeline de rendu (prévu, phase 2)

```
image bitmap
   ↓  [upload + décodage EXIF]
texture source (RGBA16F)
   ↓
┌── passe 1 — exposition / WB / tonemap  (plein cadre)
├── passe 2 — courbes + HSL
├── passe 3 — LUT 3D (sampler3D) mixée par `intensity`
└── passe 4 — grain + vignetage
   ↓  blended with the mask
framebuffer ping-pong
   ↓
canvas WebGL2 → aperçu temps réel
```

Chaque calque de masque est un framebuffer `R8` peint au pinceau, samplé dans
la passe de mélange. Le nombre de passes est borné par le nombre de calques ;
le moteur fera du *batching* (une passe, un draw call) tant qu'il n'y a pas de
dépendance entre calques.

---

## Feuille de route

| Phase | Contenu | Statut |
| --- | --- | --- |
| 1 | Squelette, thèmes, schéma Supabase, modèle `EditorState` | ✅ |
| 2 | Moteur WebGL : canvas, shaders, pinceau de masque, calques | ✅ |
| 3 | LUTs : parseur `.cube`, Hald, 25 LUTs système, shader 3D | ✅ |
| 3b | Application de bureau Electron + mise à jour automatique | ✅ |
| 4 | Auth Supabase réelle + presets + galerie | ⏳ en attente d'accord |
| 5 | Adaptateurs IA (détourage, amélioration, ciel) | ⏳ |
| 6 | Académie / ressources | ⏳ |

### Points à traiter avant une release publique

- [ ] Renseigner `LUMEN_GITHUB_OWNER` / `LUMEN_GITHUB_REPO`, et l'origine
      `http://localhost:3210` dans la configuration d'authentification
      Supabase (voir plus haut).
- [ ] Signer les installeurs Windows (certificat Authenticode) : sans cela,
      SmartScreen bloque le fichier au premier lancement.
- [ ] Vérifier le remplacement de l'AppImage à chaud : `electron-updater` doit
      pouvoir écrire dans le dossier qui contient l'exécutable. Une AppImage
      lancée depuis un dossier en lecture seule ne se mettra pas à jour.

---

## Sécurité

- `.env.local` est ignoré par git ; seul `.env.example` est versionné.
- La clé anon est publique **par design** : ce sont les RLS qui protègent les
  données, pas la clé.
- Les buckets sont privés. Les URLs de téléchargement passent par des
  URLs signées à durée courte.
- `promote_to_project()` est une fonction `security definer` : elle vérifie
  systématiquement `auth.uid()` avant d'écrire.
- Le renderer Electron tourne en bac à sable strict : `contextIsolation`,
  `sandbox`, pas de `nodeIntegration`. Un fichier photo ou une LUT importée
  n'a aucun moyen d'atteindre le système.
- Les mises à jour téléchargées sont vérifiées par checksum, et l'installation
  n'a lieu qu'à la fermeture de l'application.
