"use client";

import Lenis from "lenis";
import { ReactLenis, useLenis } from "lenis/react";

const EASING = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Configuration, not a scroll handler - but `useLenis` runs its callback on
 * every scroll emit and puts the callback in its own effect dependency array.
 * An inline arrow therefore re-subscribed on every render and rebuilt the
 * easing closure on every frame of a scroll. Module scope makes the identity
 * stable, so it subscribes once and the values are written once.
 */
const configureLenis = (lenis: Lenis) => {
  lenis.options.lerp = 0.06;
  lenis.options.easing = EASING;
};

export function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useLenis(configureLenis);

  return (
    <ReactLenis root>{children}</ReactLenis>
  );
} 