'use client'

import { useEffect } from 'react'
import { EditorWorkspace, useEditorShortcuts } from '@/components/editor/editor-workspace'
import { useEditorStore } from '@/store/editor-store'

export default function EditorPage() {
  useEditorShortcuts()

  useEffect(() => {
    document.title = 'Éditeur · Lumen Studio'

    // Accès au store depuis la console en développement : indispensable pour
    // inspecter l'état sans passer par l'UI. Jamais présent en production.
    if (process.env.NODE_ENV !== 'production') {
      ;(window as unknown as { __lumen: typeof useEditorStore }).__lumen = useEditorStore
    }
  }, [])

  return <EditorWorkspace />
}
