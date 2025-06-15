"use client";

import { ReactLenis, useLenis } from "lenis/react";

export function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useLenis((lenis) => {
    // set lenis lerp to .09
    lenis.options.lerp = 0.06;
    // lenis.options.duration = .6
    lenis.options.easing = (t) => 1 - Math.pow(1 - t, 3);
  });

  return (
    <ReactLenis root>{children}</ReactLenis>
  );
} 