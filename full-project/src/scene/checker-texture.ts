import * as THREE from "three";

/**
 * Resolution of one checker tile.
 *
 * Two texels would describe the pattern exactly and be useless. A plane repeats
 * the tile tens or hundreds of times, so the uv derivatives are large
 * everywhere and the hardware picks a low mip almost immediately - and mip
 * level 1 of a 2x2 texture is a single texel holding the average of the two
 * tones. The surface comes out a flat grey with no squares in it anywhere,
 * which is exactly what a first attempt at this produces.
 *
 * At 128 the tile has six mip levels that still contain a checker, so it stays
 * a checker up close and dissolves into its own average only in the distance,
 * where that is the right answer.
 */
const CHECKER_TILE = 128;

export interface CheckerOptions {
  light: string;
  dark: string;
  /** How many times the two-by-two tile repeats across the surface. */
  repeat: number;
  anisotropy: number;
}

/**
 * A checkerboard, drawn rather than loaded.
 *
 * Mipmapped and anisotropically filtered: a checker running to the horizon is
 * the classic aliasing case, and a nearest-filtered one would boil into moire
 * long before it got there. Which matters here beyond looking bad - a moire
 * pattern is high-frequency detail that changes completely from frame to frame,
 * and the motion field would be measuring noise.
 */
export const createCheckerTexture = ({
  light,
  dark,
  repeat,
  anisotropy,
}: CheckerOptions): THREE.DataTexture => {
  const tones = [new THREE.Color(light), new THREE.Color(dark)].map((colour) =>
    [colour.r, colour.g, colour.b].map((c) => Math.round(c * 255)),
  );

  const half = CHECKER_TILE / 2;
  const data = new Uint8Array(CHECKER_TILE * CHECKER_TILE * 4);

  for (let y = 0; y < CHECKER_TILE; y++) {
    for (let x = 0; x < CHECKER_TILE; x++) {
      const tone = tones[((x < half ? 0 : 1) + (y < half ? 0 : 1)) % 2];
      const i = (y * CHECKER_TILE + x) * 4;

      data[i] = tone[0];
      data[i + 1] = tone[1];
      data[i + 2] = tone[2];
      data[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, CHECKER_TILE, CHECKER_TILE);
  texture.name = "Checker";
  // The two tones were written as sRGB bytes, so they have to be declared as
  // such or three will treat them as linear and the surface comes out too
  // bright.
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.setScalar(repeat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;

  return texture;
};
