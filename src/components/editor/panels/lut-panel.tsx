'use client'

/**
 * Navigateur de LUTs.
 *
 * Les LUTs système viennent de `public/luts/system/` (fichiers statiques,
 * aucun aller-retour base). Les LUTs importées par l'utilisateur sont
 * converties en texture 3D à la volée — le rendu reste 100 % client, rien
 * n'est envoyé sur un serveur.
 */

import { useCallback, useEffect, useState } from 'react'
import { Check, FolderOpen, Upload } from 'lucide-react'
import { loadCatalog, textureKeyFor, type Catalog, type CatalogGroup, type CatalogLut } from '@/lib/lut/catalog'
import { inspectLut, LutParseError } from '@/lib/lut/cube'
import { lutSourceFromFile, type LutSource } from '@/lib/lut/library'
import { useEditorStore } from '@/store/editor-store'
import { cn } from '@/lib/utils'

export function LutPanel() {
  const lut = useEditorStore((s) => s.state.lut)
  const setLut = useEditorStore((s) => s.setLut)
  const clearLut = useEditorStore((s) => s.clearLut)
  const commit = useEditorStore((s) => s.commit)

  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadCatalog()
      .then(setCatalog)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // Le canvas écoute cet évènement pour charger la texture correspondante.
  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; url: string; size: number }>).detail
      if (lut.textureKey && lut.textureKey !== detail.key) {
        // L'ancienne texture peut être libérée.
        window.dispatchEvent(new CustomEvent('lumen:release-lut', { detail: lut.textureKey }))
      }
      setLut({ textureKey: detail.key, sourceUrl: detail.url })
    }
    window.addEventListener('lumen:request-lut', handle)
    return () => window.removeEventListener('lumen:request-lut', handle)
  }, [lut.textureKey, setLut])

  const onImport = useCallback(
    async (file: File) => {
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        const source: LutSource = await lutSourceFromFile(file)
        const key = textureKeyFor({ id: `user:${file.name}:${file.size}`, size: 0 })
        window.dispatchEvent(
          new CustomEvent('lumen:request-lut', {
            detail: { key, url: '', size: 0, source },
          }),
        )
        // Contrôle qualité immédiat, avant même l'affichage.
        if (source.kind === 'text') {
          const { parseCube } = await import('@/lib/lut/cube')
          const health = inspectLut(parseCube(source.text, file.name))
          if (!health.ok) setNotice(health.issues.join(' '))
        }
        setLut({ id: null, name: file.name.replace(/\.(cube|png)$/i, ''), format: source.kind === 'hald' ? 'hald' : 'cube' })
        commit()
      } catch (e: unknown) {
        setError(e instanceof LutParseError ? e.message : 'Import impossible.')
      } finally {
        setBusy(false)
      }
    },
    [commit, setLut],
  )

  if (error && !catalog) {
    return <p className="text-xs text-mask-active">{error}</p>
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">LUTs</h2>
        {lut.id || lut.name ? (
          <button
            type="button"
            onClick={() => {
              clearLut()
              commit()
            }}
            className="rounded px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            Retirer
          </button>
        ) : null}
      </header>

      <label
        className={cn(
          'flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-panel)] border border-dashed border-line px-3 py-3 text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg',
          busy && 'pointer-events-none opacity-50',
        )}
      >
        <Upload className="size-4" />
        {busy ? 'Analyse…' : 'Importer .cube ou Hald .png'}
        <input
          type="file"
          accept=".cube,.png"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void onImport(file)
            event.target.value = ''
          }}
        />
      </label>

      {notice && (
        <p className="rounded-[var(--radius-panel)] bg-surface-2 p-2.5 text-[11px] leading-snug text-fg-muted">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-[var(--radius-panel)] bg-surface-2 p-2.5 text-[11px] leading-snug text-mask-active">
          {error}
        </p>
      )}

      {catalog && (
        <div className="space-y-4">
          {catalog.groups.map((group) => (
            <GroupSection
              key={group.slug}
              group={group}
              luts={catalog.luts.filter((l) => l.group === group.slug)}
              activeKey={lut.textureKey}
              onPick={(entry) => {
                const key = textureKeyFor({ url: entry.url, size: entry.size })
                window.dispatchEvent(
                  new CustomEvent('lumen:request-lut', { detail: { key, url: entry.url, size: entry.size } }),
                )
                setLut({ id: entry.slug, slug: entry.slug, name: entry.name, format: 'cube' })
                commit()
              }}
            />
          ))}
        </div>
      )}

      <label className="block space-y-1">
        <span className="flex items-baseline justify-between text-xs text-fg-muted">
          Intensité
          <span className="tabular font-mono text-fg-subtle">
            {Math.round(lut.intensity * 100)} %
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={lut.intensity}
          disabled={!lut.textureKey}
          onChange={(event) => setLut({ intensity: Number(event.target.value) })}
          onPointerUp={commit}
          className="w-full accent-[var(--accent)] disabled:opacity-40"
        />
      </label>
    </div>
  )
}

function GroupSection({
  group,
  luts,
  activeKey,
  onPick,
}: {
  group: CatalogGroup
  luts: CatalogLut[]
  activeKey: string | null
  onPick: (lut: CatalogLut) => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-[var(--radius-panel)] px-1 py-1.5 text-left transition-colors hover:bg-surface-2"
      >
        <FolderOpen className="size-3.5 shrink-0 text-fg-subtle" />
        <span className="flex-1 text-xs font-medium">{group.name}</span>
        <span className="tabular text-[10px] text-fg-subtle">{luts.length}</span>
      </button>

      {open && (
        <ul className="mt-1 space-y-0.5 pl-1">
          {luts.map((entry) => {
            const key = textureKeyFor({ url: entry.url, size: entry.size })
            const active = activeKey === key
            return (
              <li key={entry.slug}>
                <button
                  type="button"
                  onClick={() => onPick(entry)}
                  title={entry.description}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-[var(--radius-panel)] px-2 py-1.5 text-left text-xs transition-colors',
                    active
                      ? 'bg-accent-soft text-fg'
                      : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                  )}
                >
                  <Check className={cn('size-3 shrink-0', active ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{entry.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
