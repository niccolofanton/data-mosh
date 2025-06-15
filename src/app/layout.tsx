import type { Metadata } from 'next';
import "./globals.css";
// import { geistMono, geistSans } from '@/components/fonts';
import { ClientLayout } from './client-layout';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://data-mosh-demo.vercel.app';

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
  authors: [{ name: "Data Mosh Demo" }],
  creator: "Data Mosh Demo",
  publisher: "Data Mosh Demo",
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
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'Data Moshing Demo - Interactive Digital Art Experience',
        type: 'image/jpeg',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@datamoshdemo',
    creator: '@datamoshdemo',
    title: 'Data Moshing Demo - Interactive Digital Art',
    description: 'Experience cutting-edge data moshing effects with real-time 3D graphics. Interactive digital art demo with glitch aesthetics.',
    images: ['/twitter-image.jpg'],
  },
  verification: {
    google: 'your-google-verification-code',
    // yandex: 'your-yandex-verification-code',
    // yahoo: 'your-yahoo-verification-code',
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
  appleWebApp: {
    capable: true,
    title: 'Data Mosh Demo',
    statusBarStyle: 'black-translucent',
  },
  other: {
    'theme-color': '#000000',
    'color-scheme': 'dark light',
    'viewport': 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
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
        {/* Favicon and Icons */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        
        {/* Preload critical resources */}
        <link rel="preload" href="/models" as="fetch" crossOrigin="" />
        
        {/* DNS Prefetch for external resources */}
        <link rel="dns-prefetch" href="//fonts.googleapis.com" />
        <link rel="dns-prefetch" href="//www.google-analytics.com" />
        
        {/* Additional Meta Tags */}
        <meta name="theme-color" content="#000000" />
        <meta name="color-scheme" content="dark light" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="msapplication-TileColor" content="#000000" />
        <meta name="msapplication-config" content="/browserconfig.xml" />
        
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
                "@type": "Organization",
                "name": "Data Mosh Demo"
              },
              "datePublished": "2024-01-01",
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
