"use client";

import "./globals.css";
// import { geistMono, geistSans } from '@/components/fonts';
import { ReactLenis, useLenis } from "lenis/react";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  useLenis((lenis) => {
    // set lenis lerp to .09
    lenis.options.lerp = 0.06;
    // lenis.options.duration = .6
    lenis.options.easing = (t) => 1 - Math.pow(1 - t, 3);
  });

  return (
    <html lang="en" className="h-full w-full" suppressHydrationWarning>
      {/* ${geistSans.variable} ${geistMono.variable} ${geistSans.className} */}
      <body className={` antialiased h-full w-full`}>
        <ReactLenis root>{children}</ReactLenis>
      </body>
    </html>
  );
}
