-- ===========================================================================
-- Lumen Studio — 0002 : Row Level Security
--
-- Principe : le client parle DIRECTEMENT à Supabase avec la clé anon.
-- Toute la sécurité repose donc sur ces politiques. Le backend Next.js
-- n'est pas un point de passage obligatoire pour les données.
-- ===========================================================================

alter table public.profiles         enable row level security;
alter table public.lut_groups       enable row level security;
alter table public.luts             enable row level security;
alter table public.projects         enable row level security;
alter table public.project_versions enable row level security;
alter table public.presets          enable row level security;
alter table public.storage_objects  enable row level security;
alter table public.ai_jobs          enable row level security;

-- Rappel : les tables `auth.*` sont déjà protégées par Supabase.

-- ---------------------------------------------------------------------------
-- Helper : l'utilisateur courant
-- ---------------------------------------------------------------------------

create or replace function public.current_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

-- Lecture : la table ne contient aucune donnée sensible (nom, avatar,
-- préférences d'interface). Tout le monde peut la lire, ce qui permet
-- d'afficher « retouché par <auteur> » sur un preset public.
create policy "profiles_select_all"
  on public.profiles for select
  using (true);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (id = public.current_user_id());

create policy "profiles_update_own"
  on public.profiles for update
  using (id = public.current_user_id())
  with check (id = public.current_user_id());

create policy "profiles_delete_own"
  on public.profiles for delete
  using (id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- lut_groups — lecture des groupes système + des siens, écriture sur les siens
-- ---------------------------------------------------------------------------

create policy "lut_groups_select_visible"
  on public.lut_groups for select
  using (
    scope = 'system'
    or owner_id = public.current_user_id()
  );

create policy "lut_groups_insert_own"
  on public.lut_groups for insert
  with check (
    scope = 'user'
    and owner_id = public.current_user_id()
  );

create policy "lut_groups_update_own"
  on public.lut_groups for update
  using (scope = 'user' and owner_id = public.current_user_id())
  with check (scope = 'user' and owner_id = public.current_user_id());

create policy "lut_groups_delete_own"
  on public.lut_groups for delete
  using (scope = 'user' and owner_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- luts
-- ---------------------------------------------------------------------------

create policy "luts_select_visible"
  on public.luts for select
  using (
    scope = 'system'
    or owner_id = public.current_user_id()
  );

create policy "luts_insert_own"
  on public.luts for insert
  with check (
    scope = 'user'
    and owner_id = public.current_user_id()
  );

create policy "luts_update_own"
  on public.luts for update
  using (scope = 'user' and owner_id = public.current_user_id())
  with check (scope = 'user' and owner_id = public.current_user_id());

-- La désactivation de la LUT système est interdite : seul `is_favorite`
-- peut être modifié, et uniquement sur les lignes personnelles.
create policy "luts_delete_own"
  on public.luts for delete
  using (scope = 'user' and owner_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create policy "projects_select_own"
  on public.projects for select
  using (owner_id = public.current_user_id());

create policy "projects_insert_own"
  on public.projects for insert
  with check (owner_id = public.current_user_id());

create policy "projects_update_own"
  on public.projects for update
  using (owner_id = public.current_user_id())
  with check (owner_id = public.current_user_id());

create policy "projects_delete_own"
  on public.projects for delete
  using (owner_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- project_versions
-- ---------------------------------------------------------------------------

create policy "project_versions_select_own"
  on public.project_versions for select
  using (owner_id = public.current_user_id());

create policy "project_versions_insert_own"
  on public.project_versions for insert
  with check (
    owner_id = public.current_user_id()
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = public.current_user_id()
    )
  );

create policy "project_versions_delete_own"
  on public.project_versions for delete
  using (owner_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- presets — privés pour soi, publics lisibles par tous
-- ---------------------------------------------------------------------------

create policy "presets_select_visible"
  on public.presets for select
  using (
    scope = 'public'
    or owner_id = public.current_user_id()
  );

create policy "presets_insert_own"
  on public.presets for insert
  with check (owner_id = public.current_user_id());

create policy "presets_update_own"
  on public.presets for update
  using (owner_id = public.current_user_id())
  with check (owner_id = public.current_user_id());

create policy "presets_delete_own"
  on public.presets for delete
  using (owner_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- storage_objects
-- ---------------------------------------------------------------------------

create policy "storage_objects_select_own"
  on public.storage_objects for select
  using (owner_id = public.current_user_id());

create policy "storage_objects_insert_own"
  on public.storage_objects for insert
  with check (owner_id = public.current_user_id());

create policy "storage_objects_update_own"
  on public.storage_objects for update
  using (owner_id = public.current_user_id())
  with check (owner_id = public.current_user_id());

create policy "storage_objects_delete_own"
  on public.storage_objects for delete
  using (owner_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- ai_jobs
-- ---------------------------------------------------------------------------

create policy "ai_jobs_select_own"
  on public.ai_jobs for select
  using (owner_id = public.current_user_id());

create policy "ai_jobs_insert_own"
  on public.ai_jobs for insert
  with check (owner_id = public.current_user_id());

-- Un job ne peut être modifié que par son propriétaire, et seulement
-- s'il est encore en attente (pas de réécriture d'un résultat terminé).
create policy "ai_jobs_update_own"
  on public.ai_jobs for update
  using (owner_id = public.current_user_id())
  with check (
    owner_id = public.current_user_id()
    and status in ('queued', 'running', 'failed', 'cancelled')
  );

create policy "ai_jobs_delete_own"
  on public.ai_jobs for delete
  using (owner_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- Vue storage_usage : respecte l'isolation par utilisateur
-- ---------------------------------------------------------------------------

grant select on public.storage_usage to authenticated;
alter view public.storage_usage set (security_invoker = on);
