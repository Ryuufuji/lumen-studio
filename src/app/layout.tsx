import type { Metadata, Viewport } from 'next'
import { THEME_SCRIPT, ThemeProvider } from '@/components/providers/theme-provider'
import { UpdateBadge } from '@/components/desktop/update-badge'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Lumen Studio — Retouche photo non destructive',
    template: '%s · Lumen Studio',
  },
  description:
    'Éditeur photo web : calques de masque façon Photoshop, colorimétrie façon Lightroom, LUTs 3D et rendu WebGL 100 % client.',
  applicationName: 'Lumen Studio',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#08090b' },
    { media: '(prefers-color-scheme: light)', color: '#f2ece1' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" data-theme="pro-dark" suppressHydrationWarning>
      <head>
        {/* Applique le thème avant le premier paint : pas de flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <ThemeProvider>{children}</ThemeProvider>
        {/* Rendu nul hors Electron : en navigateur, il n'y a pas de mise à
            jour automatique à signaler. */}
        <UpdateBadge />
      </body>
    </html>
  )
}
