/**
 * Utility functions for device-related operations
 */

/**
 * Gets the device pixel ratio with a maximum value to prevent performance issues
 * @returns {number} The device pixel ratio capped at 2
 */
export const getDevicePixelRatio = (): number => {
  if (typeof window === "undefined") return 1;

  // Cap the device pixel ratio to 2 to prevent performance issues on high-DPI displays
  return Math.min(window.devicePixelRatio || 1, 2);
};
