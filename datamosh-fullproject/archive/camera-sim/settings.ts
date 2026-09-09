import { OpticsSensorSettings } from "./optics-sensor";
import { SignalSettings } from "./signal";

/**
 * The camera the scene is shot on.
 *
 * There is one, not a menu of them. The goal is the look a cheap wide-angle
 * body-worn camera gives a scene - the lens, the sensor, the automatics, the
 * compression - not a museum of recording formats. Anything that only says
 * "this is a recording" rather than changing how the image itself behaves
 * (burnt-in timecode, REC dots, tape damage) is deliberately absent: it is set
 * dressing, and set dressing is not an effect.
 */
export interface CameraSettings {
  enabled: boolean;
  optics: OpticsSensorSettings;
  signal: SignalSettings;
  bloom: {
    intensity: number;
    /** Luminance a pixel has to reach before it starts to glow. */
    threshold: number;
    smoothing: number;
  };
  /** Vertical field of view in degrees. Wide is a frustum, not a distortion. */
  fov: number;
}

/**
 * Dialled in on the running scene rather than derived from a spec sheet, which
 * is why some of it reads against the physical story the rest of the code
 * tells. Worth naming the departures rather than quietly leaving them:
 *
 *   rolling shutter and AE hunting are off. Both are motion artifacts, and this
 *   pipeline already has a violent one - the datamosh. Two things bending the
 *   picture at once read as a broken renderer rather than as a camera.
 *
 *   the grade is close to neutral: no lifted blacks, no held whites, contrast
 *   barely above 1. The washed look those produce fights the effect, which
 *   needs contrast to have something to tear along, so it is carried by the
 *   vignette and the trail instead.
 *
 *   the trail is long, at 0.98, and weighted entirely to highlights. That is
 *   what carries the sense of a cheap sensor here, and it happens to be the one
 *   camera artifact that compounds with a melt rather than competing with it.
 */
export const DEFAULT_CAMERA: CameraSettings = {
  enabled: false,
  fov: 79,
  optics: {
    barrel: 0.6,
    chromaticAberration: 10,
    rollingShutter: 0,
    autoExposure: 0,
    whiteBalanceDrift: 0.3,
    noise: 0.04,
    fixedPattern: 0.2,
  },
  signal: {
    chromaBleed: 0,
    chromaDelay: 8,
    persistence: 0.98,
    persistenceBias: 1,
    lift: 0,
    liftTint: "#a7ddff",
    shoulder: 0,
    contrast: 1.07,
    saturation: 1,
    tint: "#f5f7f6",
    vignette: 0.43,
    grain: 0.02,
  },
  bloom: {
    intensity: 0.65,
    threshold: 0.75,
    smoothing: 0.3,
  },
};
