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
 * Sets up event listeners to prevent scrolling on mobile devices
 * @returns {() => void} Cleanup function to remove event listeners
 */
export const setupMobileScrollPrevention = (): (() => void) => {
  document.addEventListener("touchmove", preventScroll, { passive: false });

  return () => {
    document.removeEventListener("touchmove", preventScroll);
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
