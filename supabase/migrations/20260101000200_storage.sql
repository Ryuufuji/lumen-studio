-- ===========================================================================
-- Lumen Studio — 0003 : buckets & politiques Storage
--
-- Les fichiers sont rangés sous le préfixe `<user_id>/` : le RLS Storage de
-- Supabase permet alors d'écrire des policies très simples basées sur
-- `(storage.foldername(name))[1] = auth.uid()::text`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Buckets
-- ---------------------------------------------------------------------------

-- Photos originales (uploadées par l'utilisateur) — privé.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  false,
  26214400, -- 25 Mo
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff']
)
on conflict (id) do nothing;

-- Exports avant/après — privé, URLs signées courtes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exports',
  'exports',
  false,
  52428800, -- 50 Mo
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Fichiers .cube importés par l'utilisateur.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lut-files',
  'lut-files',
  false,
  10485760, -- 10 Mo
  array['application/octet-stream', 'text/plain', 'image/png', 'application/x-cube']
)
on conflict (id) do nothing;

-- Vignettes et aperçus (lut thumbnails, presets, miniatures projets).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'luts',
  'luts',
  false,
  2097152, -- 2 Mo
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Avatars : seul le dossier est public, l'écriture reste cloisonnée.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true, -- avatar public
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Helper : l'uid porteur du chemin
-- ---------------------------------------------------------------------------

create or replace function public.storage_owner_of(path text)
returns uuid
language sql
stable
as $$
  select (storage.foldername(path))[1]::uuid;
$$;

-- ---------------------------------------------------------------------------
-- photos
-- ---------------------------------------------------------------------------

create policy "photos_select_own"
  on storage.objects for select
  using (bucket_id = 'photos' and public.storage_owner_of(name) = auth.uid());

create policy "photos_insert_own"
  on storage.objects for insert
  with check (bucket_id = 'photos' and public.storage_owner_of(name) = auth.uid());

create policy "photos_update_own"
  on storage.objects for update
  using (bucket_id = 'photos' and public.storage_owner_of(name) = auth.uid())
  with check (bucket_id = 'photos' and public.storage_owner_of(name) = auth.uid());

create policy "photos_delete_own"
  on storage.objects for delete
  using (bucket_id = 'photos' and public.storage_owner_of(name) = auth.uid());

-- ---------------------------------------------------------------------------
-- exports
-- ---------------------------------------------------------------------------

create policy "exports_select_own"
  on storage.objects for select
  using (bucket_id = 'exports' and public.storage_owner_of(name) = auth.uid());

create policy "exports_insert_own"
  on storage.objects for insert
  with check (bucket_id = 'exports' and public.storage_owner_of(name) = auth.uid());

create policy "exports_delete_own"
  on storage.objects for delete
  using (bucket_id = 'exports' and public.storage_owner_of(name) = auth.uid());

-- ---------------------------------------------------------------------------
-- lut-files
-- ---------------------------------------------------------------------------

create policy "lut_files_select_own"
  on storage.objects for select
  using (bucket_id = 'lut-files' and public.storage_owner_of(name) = auth.uid());

create policy "lut_files_insert_own"
  on storage.objects for insert
  with check (bucket_id = 'lut-files' and public.storage_owner_of(name) = auth.uid());

create policy "lut_files_update_own"
  on storage.objects for update
  using (bucket_id = 'lut-files' and public.storage_owner_of(name) = auth.uid())
  with check (bucket_id = 'lut-files' and public.storage_owner_of(name) = auth.uid());

create policy "lut_files_delete_own"
  on storage.objects for delete
  using (bucket_id = 'lut-files' and public.storage_owner_of(name) = auth.uid());

-- ---------------------------------------------------------------------------
-- luts (vignettes)
-- ---------------------------------------------------------------------------

create policy "luts_thumbs_select_own"
  on storage.objects for select
  using (bucket_id = 'luts' and public.storage_owner_of(name) = auth.uid());

create policy "luts_thumbs_insert_own"
  on storage.objects for insert
  with check (bucket_id = 'luts' and public.storage_owner_of(name) = auth.uid());

create policy "luts_thumbs_delete_own"
  on storage.objects for delete
  using (bucket_id = 'luts' and public.storage_owner_of(name) = auth.uid());

-- ---------------------------------------------------------------------------
-- avatars — lecture publique, écriture sur son propre dossier
-- ---------------------------------------------------------------------------

create policy "avatars_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars_insert_own"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and public.storage_owner_of(name) = auth.uid());

create policy "avatars_update_own"
  on storage.objects for update
  using (bucket_id = 'avatars' and public.storage_owner_of(name) = auth.uid())
  with check (bucket_id = 'avatars' and public.storage_owner_of(name) = auth.uid());

create policy "avatars_delete_own"
  on storage.objects for delete
  using (bucket_id = 'avatars' and public.storage_owner_of(name) = auth.uid());

-- ---------------------------------------------------------------------------
-- Synchronisation storage_objects <-> storage.objects
-- L'inventaire (quota, nettoyage) se remplit automatiquement.
-- ---------------------------------------------------------------------------

create or replace function public.sync_storage_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_kind  text;
begin
  v_owner := (storage.foldername(new.name))[1]::uuid;

  v_kind := case new.bucket_id
    when 'photos'      then 'original'
    when 'exports'     then 'export'
    when 'lut-files'   then 'lut'
    when 'luts'        then 'thumbnail'
    when 'avatars'     then 'avatar'
    else 'other'
  end;

  insert into public.storage_objects (owner_id, bucket, path, kind, size_bytes, content_type)
  values (v_owner, new.bucket_id, new.name, v_kind, coalesce(new.size, 0), new.content_type)
  on conflict (bucket, path)
  do update set
    size_bytes  = excluded.size_bytes,
    content_type = excluded.content_type;

  return new;
end;
$$;

create or replace function public.delete_storage_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.storage_objects
  where bucket = old.bucket_id and path = old.name;
  return old;
end;
$$;

create trigger on_storage_object_created
  after insert on storage.objects
  for each row execute function public.sync_storage_object();

create trigger on_storage_object_updated
  after update of size, content_type on storage.objects
  for each row execute function public.sync_storage_object();

create trigger on_storage_object_deleted
  after delete on storage.objects
  for each row execute function public.delete_storage_object();

-- ---------------------------------------------------------------------------
-- Promotion d'un objet_storage en projet
-- ---------------------------------------------------------------------------

create or replace function public.promote_to_project(
  p_bucket text,
  p_path text,
  p_name text default null
)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner   uuid := auth.uid();
  v_project public.projects;
  v_meta    record;
begin
  if v_owner is null then
    raise exception 'Authentification requise';
  end if;

  select (metadata ->> 'width')::int,
         (metadata ->> 'height')::int
    into v_meta
  from storage.objects
   where bucket_id = p_bucket and name = p_path;

  insert into public.projects (owner_id, name, original_path, width, height)
  values (v_owner, coalesce(p_name, split_part(p_path, '/', 2)), p_path, v_meta.*)
  returning * into v_project;

  update public.storage_objects
     set project_id = v_project.id
   where bucket = p_bucket and path = p_path;

  return v_project;
end;
$$;

grant execute on function public.promote_to_project(text, text, text) to authenticated;
