import { BlendFunction, Effect } from "postprocessing";
import * as THREE from "three";
import { opticsSensorShader } from "./shaders/optics-sensor";
import { sceneCut } from "@/state/scene-cut";

export interface OpticsSensorSettings {
  /** k1 of the radial distortion. Positive is barrel, the wide lens look. */
  barrel: number;
  /** Lateral chromatic aberration at the corner, in pixels. */
  chromaticAberration: number;
  /** Rolling shutter strength, scaled by how fast the camera is panning. */
  rollingShutter: number;
  /** How hard the auto exposure hunts. 0 = perfectly exposed, 1 = never settles. */
  autoExposure: number;
  /** How far the auto white balance drifts. */
  whiteBalanceDrift: number;
  /** Base noise at zero gain. */
  noise: number;
  /** Share of the noise burnt into the sensor rather than changing per frame. */
  fixedPattern: number;
}

/** Stiffness of the exposure loop. */
const EXPOSURE_STIFFNESS = 26;
/**
 * Damping below 1 is what produces the overshoot, and the overshoot is the
 * whole point: an auto exposure that eased perfectly into place would look like
 * a colour grade. A camera does not settle, it hunts.
 */
const EXPOSURE_DAMPING = 0.86;

/**
 * Optics and sensor: everything that happens to the light before the encoder.
 *
 * The automatics are simulated rather than measured from the frame. Measuring
 * would mean reading the framebuffer back every frame, which stalls the
 * pipeline for an effect that does not need to be accurate - what the eye
 * recognises is the *shape* of the response (lag, overshoot, settle), not
 * whether the target matched the true scene luminance. The loop is driven by
 * the thing that would really disturb it, a cut, plus a slow wander in between.
 */
export class OpticsSensorEffect extends Effect {
  private readonly camera: THREE.Camera;

  // Exposure loop: a damped spring, which gives lag and overshoot for free.
  private exposure = 1;
  private exposureVelocity = 0;
  private exposureTarget = 1;

  private readonly whiteBalance = new THREE.Vector3(1, 1, 1);
  private readonly whiteBalanceTarget = new THREE.Vector3(1, 1, 1);

  private elapsed = 0;
  private hunt = 0;
  private drift = 0;
  private rollingShutterAmount = 0;

  // Camera state, for the rolling shutter.
  private readonly previousForward = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private hasPreviousForward = false;
  private yawRate = 0;

  private readonly unsubscribeCut: () => void;

  constructor(camera: THREE.Camera, settings: OpticsSensorSettings) {
    super("OpticsSensor", opticsSensorShader, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ["uTime", new THREE.Uniform(0)],
        ["uBarrel", new THREE.Uniform(settings.barrel)],
        ["uChromAb", new THREE.Uniform(settings.chromaticAberration)],
        ["uSkew", new THREE.Uniform(0)],
        ["uExposure", new THREE.Uniform(1)],
        ["uWhiteBalance", new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ["uGain", new THREE.Uniform(0)],
        ["uNoise", new THREE.Uniform(settings.noise)],
        ["uFixedPattern", new THREE.Uniform(settings.fixedPattern)],
      ]),
    });

    this.camera = camera;

    // A cut is the one moment a real auto exposure is guaranteed to be wrong:
    // the scene it had settled on is gone. Kicking the loop here is what
    // produces the dip and recover after every jump.
    this.unsubscribeCut = sceneCut.subscribe(() => {
      this.exposureTarget = 1 + (Math.random() - 0.5) * 1.5 * this.hunt;
      this.whiteBalanceTarget.set(
        1 + (Math.random() - 0.5) * 0.18 * this.drift,
        1,
        1 + (Math.random() - 0.5) * 0.18 * this.drift,
      );
    });
  }

  update(
    _renderer: THREE.WebGLRenderer,
    _inputBuffer: THREE.WebGLRenderTarget,
    deltaTime = 1 / 60,
  ): void {
    const dt = THREE.MathUtils.clamp(deltaTime, 1 / 240, 1 / 15);
    this.elapsed += dt;

    this.updateExposure(dt);
    this.updateWhiteBalance(dt);
    this.updateRollingShutter(dt);

    this.uniforms.get("uTime")!.value = this.elapsed;
  }

  private updateExposure(dt: number): void {
    const wander =
      Math.sin(this.elapsed * 0.37) * 0.06 +
      Math.sin(this.elapsed * 0.13 + 1.7) * 0.04;
    const target = this.exposureTarget + wander * this.hunt;

    this.exposureVelocity += (target - this.exposure) * EXPOSURE_STIFFNESS * dt;
    this.exposureVelocity *= Math.pow(EXPOSURE_DAMPING, dt * 60);
    this.exposure += this.exposureVelocity * dt;
    this.exposure = THREE.MathUtils.clamp(this.exposure, 0.25, 2.4);

    this.uniforms.get("uExposure")!.value = this.exposure;

    // AGC: opening up past neutral means the amplifier is working, and an
    // amplifier that works adds noise. Only brightening counts - stopping down
    // does not take a sensor below its own floor.
    this.uniforms.get("uGain")!.value = THREE.MathUtils.clamp(
      (this.exposure - 1) * 1.4,
      0,
      1,
    );
  }

  private updateWhiteBalance(dt: number): void {
    // Slow, and never quite arriving: an auto white balance is always a few
    // frames behind the light it is looking at.
    const k = 1 - Math.exp(-dt / 0.9);
    this.whiteBalance.lerp(this.whiteBalanceTarget, k);
    (this.uniforms.get("uWhiteBalance")!.value as THREE.Vector3).copy(
      this.whiteBalance,
    );
  }

  /**
   * Rolling shutter skew, driven by how fast the camera is turning.
   *
   * The lean is proportional to the horizontal angular rate because that is
   * literally what it measures: how far the scene travelled while the sensor
   * was being read from top to bottom.
   */
  private updateRollingShutter(dt: number): void {
    this.camera.getWorldDirection(this.forward);

    if (this.hasPreviousForward) {
      const rate =
        (this.forward.x - this.previousForward.x) * -this.previousForward.z +
        (this.forward.z - this.previousForward.z) * this.previousForward.x;

      // Smoothed: the raw per frame delta is noisy enough to make the skew
      // flicker instead of lean.
      const k = 1 - Math.exp(-dt / 0.08);
      this.yawRate += (rate / dt - this.yawRate) * k;
    }

    this.previousForward.copy(this.forward);
    this.hasPreviousForward = true;

    this.uniforms.get("uSkew")!.value =
      THREE.MathUtils.clamp(this.yawRate * 0.05, -0.35, 0.35) *
      this.rollingShutterAmount;
  }

  /**
   * The purely geometric part of this stage, for the passes downstream that
   * have to sample buffers rendered *before* the lens bent the picture.
   *
   * Read after the frame has been drawn, so the skew is the one this stage
   * actually used; a consumer applying it on the following frame is a frame
   * behind on a value that is already smoothed over about 80 ms.
   */
  get barrel(): number {
    return this.uniforms.get("uBarrel")!.value as number;
  }

  get skew(): number {
    return this.uniforms.get("uSkew")!.value as number;
  }

  applySettings(settings: OpticsSensorSettings): void {
    this.uniforms.get("uBarrel")!.value = settings.barrel;
    this.uniforms.get("uChromAb")!.value = settings.chromaticAberration;
    this.uniforms.get("uNoise")!.value = settings.noise;
    this.uniforms.get("uFixedPattern")!.value = settings.fixedPattern;

    this.rollingShutterAmount = settings.rollingShutter;
    this.hunt = settings.autoExposure;
    this.drift = settings.whiteBalanceDrift;

    // With the automatics turned off the loop has to be released back to
    // neutral, or the last value it happened to hold would stay burnt in.
    if (this.hunt <= 0) this.exposureTarget = 1;
    if (this.drift <= 0) this.whiteBalanceTarget.set(1, 1, 1);
  }

  dispose(): void {
    this.unsubscribeCut();
    super.dispose();
  }
}
