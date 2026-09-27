-- ===========================================================================
-- Lumen Studio — 0001 : schéma applicatif
-- Exécution : `supabase db reset` (ou `supabase migration up`)
-- ===========================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Types énumérés
-- ---------------------------------------------------------------------------

-- `system` = livré avec l'application, visible par tous.
-- `user`   = créé par un compte, visible par son propriétaire uniquement.
create type public.lut_scope as enum ('system', 'user');

-- `cube`  = table de correspondance 1D/3D texte (.cube)
-- `hald`  = image PNG de type Hald CLUT
create type public.lut_format as enum ('cube', 'hald', 'identity');

-- Un preset est soit privé, soit publié dans la galerie communautaire.
create type public.preset_scope as enum ('private', 'public');

-- Catégorie d'un preset, alignée sur les onglets de l'UI.
create type public.preset_category as enum (
  'light',
  'color',
  'details',
  'curves',
  'cinematic',
  'film',
  'bw',
  'custom'
);

-- Traitement IA asynchrone (la phase IA branchera un worker ici).
create type public.ai_job_kind as enum (
  'auto_mask',
  'subject_cutout',
  'enhance',
  'sky_replace',
  'upscale'
);

create type public.ai_job_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled'
);

-- ---------------------------------------------------------------------------
-- updated_at : trigger générique
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — 1:1 avec auth.users
-- ---------------------------------------------------------------------------

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  display_name  text,
  avatar_path   text,

  -- Préférence d'interface persistée entre les sessions.
  default_theme text not null default 'pro-dark',

  -- Quota de stockage de l'espace personnel, en Mo.
  storage_quota_mb integer not null default 20480
    check (storage_quota_mb > 0),

  -- Réglages d'UI persistés (panneaux ouverts, dernier outil, etc.)
  editor_prefs jsonb not null default '{}'::jsonb,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is
  'Profil utilisateur, créé automatiquement à l''inscription (trigger on auth.users).';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Provisionnement du profil à l'inscription.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- lut_groups — arborescence de dossiers de LUTs (système + personnels)
-- ---------------------------------------------------------------------------

create table public.lut_groups (
  id          uuid primary key default gen_random_uuid(),

  -- NULL pour un groupe système, l'uid du propriétaire pour un groupe perso.
  owner_id    uuid references auth.users (id) on delete cascade,
  scope       public.lut_scope not null default 'user',

  slug        text,
  name        text not null,
  description text,
  icon        text,
  parent_id   uuid references public.lut_groups (id) on delete set null,
  sort_order  integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Un dossier ne peut pas être son propre parent.
  constraint lut_groups_no_self_parent check (parent_id is null or parent_id <> id),

  -- Cohérence owner <-> scope : un groupe système n'a pas de propriétaire.
  constraint lut_groups_owner_scope check (
    (scope = 'system' and owner_id is null) or
    (scope = 'user'   and owner_id is not null)
  )
);

comment on table public.lut_groups is
  'Dossiers de LUTs. Les groupes système sont en lecture seule pour les utilisateurs.';

create trigger lut_groups_set_updated_at
  before update on public.lut_groups
  for each row execute function public.set_updated_at();

-- Unicité du slug : un par groupe système, un par groupe utilisateur.
create unique index lut_groups_system_slug_key
  on public.lut_groups (slug) where scope = 'system';

create unique index lut_groups_user_slug_key
  on public.lut_groups (owner_id, slug) where scope = 'user';

create index lut_groups_owner_idx    on public.lut_groups (owner_id, sort_order);
create index lut_groups_parent_idx   on public.lut_groups (parent_id);
create index lut_groups_scope_idx    on public.lut_groups (scope);

-- ---------------------------------------------------------------------------
-- luts — catalogue (système + imports utilisateur)
-- ---------------------------------------------------------------------------

create table public.luts (
  id            uuid primary key default gen_random_uuid(),

  owner_id      uuid references auth.users (id) on delete cascade,
  scope         public.lut_scope not null default 'user',
  group_id      uuid references public.lut_groups (id) on delete set null,

  slug          text not null,
  name          text not null,
  description   text,
  author        text,

  format        public.lut_format not null default 'cube',

  -- Pour `cube` : taille du cube 1D (17, 33, 65).
  -- Pour `hald`  : niveau de la Hald CLUT (2 = 8x8x8, 8 = 64^3).
  size          integer not null default 33 check (size between 2 and 65),

  -- Chemin du fichier source dans le bucket `lut-files` pour les LUTs
  -- utilisateur. Pour les LUTs système, chemin sous /public/luts/system.
  storage_path  text,

  file_size_bytes bigint not null default 0 check (file_size_bytes >= 0),
  content_hash  text,

  -- Vignette de prévisualisation (bucket `luts`).
  thumbnail_path text,

  -- Une seule LUT active à la fois par utilisateur.
  is_active     boolean not null default false,
  is_favorite   boolean not null default false,
  intensity     real not null default 1.0 check (intensity between 0 and 1),

  sort_order    integer not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint luts_owner_scope check (
    (scope = 'system' and owner_id is null) or
    (scope = 'user'   and owner_id is not null)
  ),

  -- Une LUT système exige un chemin local, une LUT utilisateur un stockage.
  constraint luts_source_path check (
    (scope = 'system' and storage_path is not null) or
    (scope = 'user')
  )
);

comment on table public.luts is
  'LUTs 3D (.cube) et Hald CLUT (.png) applicables par shader WebGL.';

comment on column public.luts.size is
  'Taille 1D du cube .cube, ou niveau Hald (2 => 8³, 8 => 64³).';

create trigger luts_set_updated_at
  before update on public.luts
  for each row execute function public.set_updated_at();

create index luts_owner_idx  on public.luts (owner_id, sort_order);
create index luts_group_idx  on public.luts (group_id, sort_order);
create index luts_scope_idx  on public.luts (scope);
create index luts_fav_idx    on public.luts (owner_id) where is_favorite;

create unique index luts_system_slug_key
  on public.luts (slug) where scope = 'system';

create unique index luts_user_slug_key
  on public.luts (owner_id, slug) where scope = 'user';

-- Partial unique : au plus une LUT active par utilisateur.
create unique index luts_single_active_per_user
  on public.luts (owner_id) where is_active;

-- ---------------------------------------------------------------------------
-- projects — une photo en cours ou terminée (avant / après)
-- ---------------------------------------------------------------------------

create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,

  name          text not null,

  -- Chemins dans le bucket `photos`.
  original_path text not null,
  export_path   text,
  thumb_path    text,

  width         integer check (width is null or width > 0),
  height        integer check (height is null or height > 0),
  file_size_bytes bigint not null default 0,

  -- État complet et non destructif de l'éditeur (sliders + LUT + masques).
  settings      jsonb not null default '{}'::jsonb,
  -- Incrémenté à chaque écriture : sert de optimistic-lock client.
  settings_version integer not null default 1,

  -- Métadonnées EXIF à la volée, pour l'affichage dans l'inspecteur.
  metadata      jsonb not null default '{}'::jsonb,

  last_opened_at timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.projects.settings is
  'Document EditorState sérialisé : ajustements, LUT, calques de masques.';

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create index projects_owner_idx on public.projects (owner_id, last_opened_at desc);
create index projects_settings_idx on public.projects using gin (settings);

-- ---------------------------------------------------------------------------
-- project_versions — historique d'édition (undo non destructif, versionnage)
-- ---------------------------------------------------------------------------

create table public.project_versions (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id   uuid not null references auth.users (id) on delete cascade,

  label      text,
  settings   jsonb not null,

  created_at timestamptz not null default now()
);

comment on table public.project_versions is
  'Instantanés ponctuels de l''état de l''éditeur, pour l''historique.';

create index project_versions_project_idx
  on public.project_versions (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- presets — réglages réutilisables
-- ---------------------------------------------------------------------------

create table public.presets (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,

  name          text not null,
  description   text,
  category      public.preset_category not null default 'custom',
  scope         public.preset_scope not null default 'private',

  -- >>> LE CŒUR DU SYSTÈME <<<
  -- JSON contenant les valeurs exactes de tous les sliders
  -- (lumière / couleur / détails / courbes) et des masques.
  settings      jsonb not null default '{}'::jsonb,

  -- Version du schéma JSON : permet de migrer les anciens presets
  -- quand la structure d'EditorState évolue.
  schema_version integer not null default 1,

  -- LUT active au moment de la sauvegarde.
  -- set null si la LUT est supprimée ; lut_name reste alors lisible.
  lut_id        uuid references public.luts (id) on delete set null,
  lut_name      text,
  lut_intensity real not null default 1.0 check (lut_intensity between 0 and 1),

  -- Contexte de capture, pour proposer le preset au bon moment.
  camera_make   text,
  camera_model  text,
  lens          text,
  iso_band      integer check (iso_band is null or iso_band > 0),

  thumbnail_path text,

  usage_count   integer not null default 0,
  last_used_at  timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.presets is
  'Réglages sauvegardés : réappliquables instantanément sur une photo similaire.';

create trigger presets_set_updated_at
  before update on public.presets
  for each row execute function public.set_updated_at();

create index presets_owner_idx    on public.presets (owner_id, category, name);
create index presets_public_idx   on public.presets (created_at desc) where scope = 'public';
create index presets_settings_idx on public.presets using gin (settings);
create index presets_lut_idx      on public.presets (lut_id);

-- ---------------------------------------------------------------------------
-- storage_objects — inventaire des fichiers pour le quota et le nettoyage
-- ---------------------------------------------------------------------------

create table public.storage_objects (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,

  bucket     text not null check (bucket in ('photos', 'lut-files', 'luts', 'avatars', 'exports')),
  path       text not null,

  -- original | export | lut | thumbnail | avatar
  kind       text not null,

  size_bytes bigint not null default 0 check (size_bytes >= 0),
  content_type text,

  project_id uuid references public.projects (id) on delete cascade,

  created_at timestamptz not null default now(),

  unique (bucket, path)
);

create index storage_objects_owner_idx  on public.storage_objects (owner_id, created_at desc);
create index storage_objects_project_idx on public.storage_objects (project_id);

-- ---------------------------------------------------------------------------
-- ai_jobs — file de traitement IA (implémentée en phase 5)
-- ---------------------------------------------------------------------------

create table public.ai_jobs (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,

  kind       public.ai_job_kind not null,
  status     public.ai_job_status not null default 'queued',

  -- 'local'   : modèle embarqué (ex. ONNX via WebGPU + @imgly/background-removal)
  -- 'hf'      : Hugging Face Inference API
  -- 'replicate': Replicate
  provider   text not null default 'local',
  model      text,

  params     jsonb not null default '{}'::jsonb,
  result     jsonb,
  error      text,

  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),

  -- Empêche deux workers de traiter simultanément le même job.
  constraint ai_jobs_running_unique
    unique (id) where status = 'running'
);

create index ai_jobs_owner_idx  on public.ai_jobs (owner_id, created_at desc);
create index ai_jobs_status_idx on public.ai_jobs (status, created_at)
  where status in ('queued', 'running');

-- ---------------------------------------------------------------------------
-- Vue de confort : taille de stockage utilisée par utilisateur
-- ---------------------------------------------------------------------------

create or replace view public.storage_usage as
  select
    owner_id,
    bucket,
    sum(size_bytes) as total_bytes,
    count(*)       as file_count
  from public.storage_objects
  group by owner_id, bucket;

-- ---------------------------------------------------------------------------
-- updated_at sur project_versions / ai_jobs n'est pas nécessaire (append-only),
-- mais on ajoute un trigger sur luts/presets/profiles — déjà fait ci-dessus.
-- ---------------------------------------------------------------------------
