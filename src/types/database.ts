/**
 * Types de la base Supabase — MIROIR MANUEL de `supabase/migrations/*`.
 *
 * En pratique, préférez la version générée :
 *   npm run supabase:gen-types  →  src/types/database.generated.ts
 *
 * Ce fichier existe pour que le typage fonctionne dès le premier `npm run dev`,
 * sans avoir à démarrer Docker. Dès que le CLI est disponible, remplacez le
 * contenu par :  export type { Database } from './database.generated'
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type LutScope = 'system' | 'user'
export type LutFormat = 'cube' | 'hald' | 'identity'
export type PresetScope = 'private' | 'public'
export type PresetCategory =
  | 'light'
  | 'color'
  | 'details'
  | 'curves'
  | 'cinematic'
  | 'film'
  | 'bw'
  | 'custom'
export type AiJobKind = 'auto_mask' | 'subject_cutout' | 'enhance' | 'sky_replace' | 'upscale'
export type AiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

type Row<RowData, InsertData = Partial<RowData>, UpdateData = Partial<InsertData>> = {
  Row: RowData
  Insert: InsertData
  Update: UpdateData
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      profiles: Row<
        {
          id: string
          email: string
          display_name: string | null
          avatar_path: string | null
          default_theme: string
          storage_quota_mb: number
          editor_prefs: Json
          created_at: string
          updated_at: string
        },
        { id: string; email: string; display_name?: string | null; avatar_path?: string | null }
      >
      lut_groups: Row<
        {
          id: string
          owner_id: string | null
          scope: LutScope
          slug: string | null
          name: string
          description: string | null
          icon: string | null
          parent_id: string | null
          sort_order: number
          created_at: string
          updated_at: string
        },
        { name: string; owner_id: string; scope?: LutScope; slug?: string | null }
      >
      luts: Row<
        {
          id: string
          owner_id: string | null
          scope: LutScope
          group_id: string | null
          slug: string
          name: string
          description: string | null
          author: string | null
          format: LutFormat
          size: number
          storage_path: string | null
          file_size_bytes: number
          content_hash: string | null
          thumbnail_path: string | null
          is_active: boolean
          is_favorite: boolean
          intensity: number
          sort_order: number
          created_at: string
          updated_at: string
        },
        {
          owner_id: string
          scope?: LutScope
          name: string
          slug: string
          format?: LutFormat
          group_id?: string | null
        }
      >
      projects: Row<
        {
          id: string
          owner_id: string
          name: string
          original_path: string
          export_path: string | null
          thumb_path: string | null
          width: number | null
          height: number | null
          file_size_bytes: number
          settings: Json
          settings_version: number
          metadata: Json
          last_opened_at: string
          created_at: string
          updated_at: string
        },
        { owner_id: string; name: string; original_path: string }
      >
      project_versions: Row<{
        id: string
        project_id: string
        owner_id: string
        label: string | null
        settings: Json
        created_at: string
      }>
      presets: Row<
        {
          id: string
          owner_id: string
          name: string
          description: string | null
          category: PresetCategory
          scope: PresetScope
          settings: Json
          schema_version: number
          lut_id: string | null
          lut_name: string | null
          lut_intensity: number
          camera_make: string | null
          camera_model: string | null
          lens: string | null
          iso_band: number | null
          thumbnail_path: string | null
          usage_count: number
          last_used_at: string | null
          created_at: string
          updated_at: string
        },
        { owner_id: string; name: string; settings: Json; category?: PresetCategory }
      >
      storage_objects: Row<
        {
          id: string
          owner_id: string
          bucket: string
          path: string
          kind: string
          size_bytes: number
          content_type: string | null
          project_id: string | null
          created_at: string
        },
        { owner_id: string; bucket: string; path: string; kind: string }
      >
      ai_jobs: Row<
        {
          id: string
          owner_id: string
          project_id: string | null
          kind: AiJobKind
          status: AiJobStatus
          provider: string
          model: string | null
          params: Json
          result: Json | null
          error: string | null
          started_at: string | null
          finished_at: string | null
          created_at: string
        },
        { owner_id: string; kind: AiJobKind }
      >
    }
    Views: {
      storage_usage: {
        Row: { owner_id: string; bucket: string; total_bytes: number; file_count: number }
      }
    }
    Functions: {
      promote_to_project: {
        Args: { p_bucket: string; p_path: string; p_name?: string | null }
        Returns: Database['public']['Tables']['projects']['Row']
      }
      storage_owner_of: { Args: { path: string }; Returns: string }
    }
    Enums: {
      lut_scope: LutScope
      lut_format: LutFormat
      preset_scope: PresetScope
      preset_category: PresetCategory
      ai_job_kind: AiJobKind
      ai_job_status: AiJobStatus
    }
  }
}

/** Raccourcis d'accès aux types de ligne les plus utilisés. */
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Lut = Database['public']['Tables']['luts']['Row']
export type LutGroup = Database['public']['Tables']['lut_groups']['Row']
export type Project = Database['public']['Tables']['projects']['Row']
export type Preset = Database['public']['Tables']['presets']['Row']
export type AiJob = Database['public']['Tables']['ai_jobs']['Row']
