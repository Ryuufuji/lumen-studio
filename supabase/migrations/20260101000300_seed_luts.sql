-- ===========================================================================
-- Lumen Studio — 0004 : seed du catalogue de LUTs systeme
--
-- Ces LUTs sont livrees avec l'application (dossier `public/luts/system/`)
-- et sont en lecture seule. Elles sont toutes libres de droits : profiles
-- cinematographiques ouverts et interpretations de simulations film
-- recalculees a la main.
-- ===========================================================================

insert into public.lut_groups (slug, name, description, icon, sort_order)
values
  ('cinematic',     'Cinematic',   'Profils de graded films : teal & orange, bleach bypass.', 'film',     10),
  ('film-emulation','Fujifilm',    'Simulations Fujifilm (Classic Chrome, Astia, Provia).',  'camera',   20),
  ('vintage',       'Vintage',     'Ports analogiques, virage, grain argentique.',           'clock',    30),
  ('bw',            'Noir & B&W',  'Conversions monochromes haute densite.',                 'contrast', 40),
  ('creative',      'Creatives',   'Looks tres types (cyberpunk, solarise, froid).',          'sparkles', 50)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Catalogue
-- storage_path pointe vers /public : aucune donnee n'est stockee en base,
-- les fichiers .cube sont servis statiquement par Next.js.
-- ---------------------------------------------------------------------------

insert into public.luts
  (scope, group_id, slug, name, description, author, format, size, storage_path, sort_order)
select
  'system'::public.lut_scope,
  g.id,
  v.slug,
  v.name,
  v.description,
  v.author,
  'cube'::public.lut_format,
  v.size,
  '/luts/system/' || v.slug || '.cube',
  v.sort_order
from (values
  -- Cinematic ---------------------------------------------------------------
  ('cinematic', 'cinematic', 'Teal Orange',        'Contraste cinematographique, ombres froides et hautes lumieres chaudes.', 'Lumen Studio',       10),
  ('cinematic', 'cinematic', 'Bleach Bypass',      'Silver halide : contraste sec, desaturation legere.',                   'Lumen Studio',       20),
  ('cinematic', 'cinematic', 'Blockbuster Contrast','Noirs profonds, hautes lumieres brulees, courbe S appliquee.',            'Lumen Studio',       30),
  ('cinematic', 'cinematic', 'Navy Fade',          'Bleu nuit, noirs delaves, ambiance urbaine.',                            'Lumen Studio',       40),
  ('cinematic', 'cinematic', 'Sunset Gold',        'Hautes lumieres dorees, ombres magenta.',                                 'Lumen Studio',       50),
  ('cinematic', 'cinematic', 'Matte Film',         'Noirs releves (lifted blacks), rendu pellicule mate.',                   'Lumen Studio',       60),

  -- Fujifilm ----------------------------------------------------------------
  ('film-emulation', 'fujifilm', 'Classic Chrome',   'Couleurs sourdes, ombres vert-olive, rendu journal.',                    'Dérivé Fujifilm',   10),
  ('film-emulation', 'fujifilm', 'Astia',            'Couleurs douces, contraste modere, peau flattee.',                      'Dérivé Fujifilm',   20),
  ('film-emulation', 'fujifilm', 'Provia',           'Negatif standard, couleurs denses, usage general.',                       'Dérivé Fujifilm',   30),
  ('film-emulation', 'fujifilm', 'Velvia',           'Saturations elevees, tons tres froids. Paysages et couchers.  ',         'Dérivé Fujifilm',   40),
  ('film-emulation', 'fujifilm', 'Eterna',           'Ombres vertes, rendu cinema discret.',                                    'Dérivé Fujifilm',   50),
  ('film-emulation', 'fujifilm', 'Acros',            'Noir et blanc avec grain fin et courbe douce.',                         'Dérivé Fujifilm',   60),

  -- Vintage -----------------------------------------------------------------
  ('vintage', 'vintage', 'Portra 400 Warm',    'Dore, tons chairs legerement delaves, grain fin.',     'Interprétation libre', 10),
  ('vintage', 'vintage', 'Kodak Gold 200',    'Jaunes chauds, ombres orangees.',                        'Interprétation libre', 20),
  ('vintage', 'vintage', 'Ektachrome Shift',  'Cyan des ombres, look annees 70.',                       'Interprétation libre', 30),
  ('vintage', 'vintage', 'Faded Polaroid',    'Noirs laiteux, contraste tres bas.',                     'Interprétation libre', 40),
  ('vintage', 'vintage', 'Sepia Tone',        'Virage sepia classique, contraste doux.',                'Interprétation libre', 50),

  -- B&W ---------------------------------------------------------------------
  ('bw', 'bw', 'High Contrast Mono',  'Courbe S forte, noirs et blancs nets.',               'Lumen Studio', 10),
  ('bw', 'bw', 'Soft Silver',         'Courbe S douce, blanc lumineux, rendu portrait.',    'Lumen Studio', 20),
  ('bw', 'bw', 'Panchromatic',        'Rend les verts sombres, ciel classique.',              'Lumen Studio', 30),
  ('bw', 'bw', 'Infrared Film',       'Noir et blanc tres contraste, atmosphere',            'Lumen Studio', 40),

  -- Creatives ---------------------------------------------------------------
  ('creative', 'creative', 'Cyberpunk',    'Magenta et cyan, tres sature.',                      'Lumen Studio', 10),
  ('creative', 'creative', 'Solarize',    'Inversion partielle, rendu psychedelique.',           'Lumen Studio', 20),
  ('creative', 'creative', 'Arctic Cold', 'Bleu glacier, desaturation des rouges.',               'Lumen Studio', 30),
  ('creative', 'creative', 'Desert Warm', 'Sable et ocre, split-toning marque.',                'Lumen Studio', 40)
) as v (group_slug, slug, name, description, author, sort_order)
join public.lut_groups g on g.slug = v.group_slug and g.scope = 'system'
on conflict do nothing;
