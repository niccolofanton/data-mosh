/**
 * Utility functions for event handling
 */

/**
 * Prevents default scroll behavior on mobile devices
 * @param {TouchEvent} e - The touch event to prevent
 */
export const preventScroll = (e: TouchEvent): void => {
  e.preventDefault();
};

/**
 * Stops a touch drag on the 3D view from scrolling the page.
 *
 * Scoped to a target element rather than to `document`. `{ passive: false }` is
 * genuinely required for `preventDefault` to have any effect, and a non-passive
 * `touchmove` listener opts its target out of the browser's compositor fast
 * path: every touch move has to round-trip through the main thread before the
 * browser knows whether it may scroll. On `document` that applied to the whole
 * page - including the control panel, which could then never be scrolled - and
 * the main thread it was waiting on is the one running the composer chain.
 * Bound to the canvas, the cost is confined to gestures on the view itself,
 * which is the behaviour this was always meant to produce.
 */
export const setupMobileScrollPrevention = (target: HTMLElement): (() => void) => {
  target.addEventListener("touchmove", preventScroll, { passive: false });

  return () => {
    target.removeEventListener("touchmove", preventScroll);
  };
};

/**
 * Sets up visibility change detection to pause rendering when tab is not visible
 * @param {(isVisible: boolean) => void} callback - Function to call when visibility changes
 * @returns {() => void} Cleanup function to remove event listeners
 */
export const setupVisibilityChangeDetection = (
  callback: (isVisible: boolean) => void,
): (() => void) => {
  const handleVisibilityChange = () => {
    callback(!document.hidden);
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
};
