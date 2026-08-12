import type { Metadata, Viewport } from 'next';
import "./globals.css";
// import { geistMono, geistSans } from '@/components/fonts';
import { ClientLayout } from './client-layout';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://data-mosh-demo.vercel.app';

const author = {
  name: 'Niccolò Fanton',
  url: 'https://niccolofanton.dev',
};

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
  colorScheme: 'dark light',
};

export const metadata: Metadata = {
  title: "Data Moshing Demo - Niccolò Fanton",
  description: "Experience cutting-edge data moshing effects with real-time 3D graphics. An interactive digital art demo showcasing glitch aesthetics, visual corruption, and experimental web technologies.",
  keywords: [
    "data moshing",
    "glitch art",
    "digital art",
    "interactive demo",
    "WebGL",
    "Three.js",
    "visual effects",
    "experimental art",
    "generative art",
    "real-time graphics",
    "shader effects",
    "visual corruption",
    "digital artifacts"
  ],
  authors: [author],
  creator: author.name,
  publisher: author.name,
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: 'Data Moshing Demo',
    title: 'Data Moshing Demo - Interactive Digital Art Experience',
    description: 'Experience cutting-edge data moshing effects with real-time 3D graphics. An interactive digital art demo showcasing glitch aesthetics and experimental web technologies.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Data Moshing Demo - Interactive Digital Art Experience',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Data Moshing Demo - Interactive Digital Art',
    description: 'Experience cutting-edge data moshing effects with real-time 3D graphics. Interactive digital art demo with glitch aesthetics.',
    images: ['/og-image.png'],
  },
  alternates: {
    canonical: siteUrl,
  },
  category: 'Digital Art',
  classification: 'Interactive Art Demo',
  referrer: 'origin-when-cross-origin',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(siteUrl),
  generator: 'Next.js',
  applicationName: 'Data Moshing Demo',
  manifest: '/manifest.json',
  icons: {
    // `app/favicon.ico` is picked up automatically by Next.
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Data Mosh Demo',
    statusBarStyle: 'black-translucent',
  },
  other: {
    // Standards-track replacement for `apple-mobile-web-app-capable`, which
    // Next already emits from `appleWebApp` above.
    'mobile-web-app-capable': 'yes',
    'msapplication-TileColor': '#000000',
    'msapplication-config': '/browserconfig.xml',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full w-full" suppressHydrationWarning>
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
          connection takes that round trip off the critical path. (The decoder
          is ~100 KB to decompress 7.7 KB of geometry, which is worth revisiting
          separately.)
        */}
        <link rel="preconnect" href="https://www.gstatic.com" crossOrigin="anonymous" />

        {/* The rest of the scene: not render-blocking, but wanted early. */}
        <link
          rel="preload"
          href="/hdri/kloppenheim-puresky-1k.hdr"
          as="fetch"
          crossOrigin="anonymous"
        />

        {/* Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              "name": "Data Moshing Demo",
              "description": "Interactive digital art experience showcasing data moshing effects with real-time 3D graphics",
              "url": siteUrl,
              "applicationCategory": "Digital Art",
              "operatingSystem": "Web Browser",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
              },
              "creator": {
                "@type": "Person",
                "name": author.name,
                "url": author.url
              },
              "genre": ["Digital Art", "Interactive Media", "Experimental Art"],
              "keywords": "data moshing, glitch art, digital art, interactive demo, WebGL, Three.js, visual effects"
            })
          }}
        />
      </head>
      {/* ${geistSans.variable} ${geistMono.variable} ${geistSans.className} */}
      <body className={` antialiased h-full w-full`}>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
