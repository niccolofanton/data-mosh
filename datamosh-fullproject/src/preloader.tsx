import { useEffect, useRef } from 'react';
import { useProgress } from '@react-three/drei';

/**
 * Drives the overlay declared in `index.html`.
 *
 * The markup lives there rather than here on purpose: the scene is gated on
 * roughly 8 MB of room, rig and sky, and the overlay has to be on screen from
 * the very first paint - long before this bundle has been fetched and parsed.
 * So React never renders it. It only reports progress into it, and removes
 * `body.loading` when the assets are in; the CSS does the fade.
 *
 * `useProgress` reads three's `DefaultLoadingManager`, which is what drei's
 * `useGLTF`, `useFBX` and `useEnvironment` all queue their requests on.
 */

/**
 * How long the manager has to stay idle before the load counts as finished.
 *
 * `active` drops to false the moment the queue empties, and the queue empties
 * briefly between waves - the room is preloaded at module scope, while the sky
 * and the dancer are requested when their Suspense boundaries first render. A
 * short settle window keeps that gap from being mistaken for the end.
 */
const SETTLE_MS = 500;

/**
 * Hard ceiling. A 404 or a dropped connection leaves an item queued forever,
 * and an overlay that never lifts is a worse failure than a scene that is still
 * missing a prop: past this the page is handed over regardless.
 */
const TIMEOUT_MS = 20_000;

export const Preloader = () => {
  const { active, progress, total } = useProgress();
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Progress bar. Written straight to the DOM: it changes on every chunk, and
  // there is nothing here for React to reconcile.
  useEffect(() => {
    const fill = document.getElementById('loader-fill');
    if (fill !== null) fill.style.transform = `scaleX(${progress / 100})`;
  }, [progress]);

  useEffect(() => {
    const done = () => document.body.classList.remove('loading');
    const timeout = setTimeout(done, TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    clearTimeout(settle.current);
    // `total` guards the initial state, where nothing has been requested yet
    // and the manager is idle for the ordinary reason.
    if (active || total === 0) return;
    settle.current = setTimeout(
      () => document.body.classList.remove('loading'),
      SETTLE_MS,
    );
    return () => clearTimeout(settle.current);
  }, [active, total]);

  return null;
};
