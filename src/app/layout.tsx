import type { Metadata, Viewport } from 'next';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://data-mosh-demo.vercel.app';

const author = {
  name: 'Niccolò Fanton',
  url: 'https://niccolofanton.dev',
};

const title = 'Data Moshing Demo';
const description =
  'A real-time datamosh effect in WebGL: motion vectors, macroblocks and residuals, running on three.js.';

/**
 * The scene is a full-screen WebGL canvas driven by pointer/scroll gestures, so
 * pinch-zoom is disabled on purpose to avoid fighting the camera controls.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#000000',
  colorScheme: 'dark',
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: `${title} - ${author.name}`,
  description,
  keywords: ['datamosh', 'glitch art', 'WebGL', 'three.js', 'shader effects'],
  authors: [author],
  creator: author.name,
  alternates: { canonical: siteUrl },
  manifest: '/manifest.json',
  icons: {
    // `app/favicon.ico` is picked up automatically by Next.
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    type: 'website',
    url: siteUrl,
    siteName: title,
    title,
    description,
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: title }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          The scene's only heavy asset. three.js' FileLoader fetches it with the
          default CORS mode, so `as="fetch"` + `crossOrigin="anonymous"` is what
          makes the preload match the real request instead of duplicating it.
        */}
        <link
          rel="preload"
          href="/models/backroom-transformed.glb"
          as="fetch"
          type="model/gltf-binary"
          crossOrigin="anonymous"
        />

        {/*
          That GLB declares KHR_draco_mesh_compression, and drei points its
          DRACOLoader at gstatic - so parsing the file that gates the whole
          canvas cannot begin until a wasm wrapper and a decoder land from a
          third origin, behind a fresh DNS lookup and TLS handshake. Warming the
          connection takes that round trip off the critical path.
        */}
        <link rel="preconnect" href="https://www.gstatic.com" crossOrigin="anonymous" />

        {/* The rest of the scene: not render-blocking, but wanted early. */}
        <link
          rel="preload"
          href="/hdri/kloppenheim-puresky-1k.hdr"
          as="fetch"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
