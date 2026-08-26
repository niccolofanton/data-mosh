import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import * as THREE from "three";
import { mainImageShader } from "./shaders";

/**
 * Everything the effect and the pipeline can be tuned with.
 *
 * The whole object is replaced on every update instead of being merged field by
 * field: it is cheap, and it keeps a single source of truth for the settings.
 */
/** Where the motion vectors come from. */
export type MotionSource =
  /** Screen space velocity buffer: camera *and* object movement. */
  | "velocity"
  /** Camera movement only, by exact depth reprojection. One render pass cheaper. */
  | "camera";

export interface DataMoshSettings {
  /** Master switch: when false the mosh and feedback passes are skipped. */
  effectEnabled: boolean;
  /**
   * Cut the scene when a melt gesture starts, so the incoming motion belongs to
   * a shot the picture on screen never saw: the camera jumps to another side of
   * the room, the subject becomes another shape, the room changes scale. What
   * exactly changes is up to whatever the scene subscribed to `sceneCut`.
   */
  sceneCut: boolean;
  /** Duration of the cross fade back to the clean image, in milliseconds. */
  fadeDuration: number;
  /**
   * Milliseconds between two keyframes during a gesture. 0 keeps the very first
   * keyframe for the whole gesture (an infinite GOP), which is the classic
   * "all I-frames removed" look.
   */
  keyframeInterval: number;

  /** Which motion vector field drives the reprojection. */
  motionSource: MotionSource;
  /** Exaggeration of the motion vectors. 1 = physically correct. */
  motionGain: number;
  /**
   * Weight of the depth dependent (translation) part of the motion. Only
   * affects the camera-only source: a velocity buffer measures parallax
   * directly, so there is nothing left to weight.
   */
  parallax: number;

  /** Macroblock edge, in pixels. */
  blockSize: number;
  /** 0 = continuous per pixel warp (liquid smear), 1 = fully quantised blocks. */
  blockiness: number;
  /** Share of coded macroblocks that lose their motion vector and stay put. */
  frozenBlocks: number;
  /** Overlapping grids of lost regions, each finer than the last. 1 to 4. */
  lostLayers: number;
  /** FXAA on the clean render, before the encoder sees it. */
  antialias: boolean;
  /** How long a lost-vector region lasts, in milliseconds. */
  lostLife: number;
  /** Region size: bigger value means fewer, larger regions. */
  lostScale: number;
  /** Above 1 the regions are wide rectangles, below 1 tall ones. */
  lostAspect: number;
  /** 0 = every region the same size, 1 = wildly varied. */
  lostVariance: number;
  /** Sub pixel steps per pixel: 1 = full pel, 2 = half pel (MPEG-4), 4 = quarter pel. */
  mvPrecision: number;
  /** Motion, in pixels, below which a block is not coded at all (skipped). */
  skipThreshold: number;
  /** Share of blocks that pick up a neighbour's vector (motion compensation mismatch). */
  mismatch: number;

  /** How much of the incoming picture bleeds through as residual. */
  residualGain: number;
  /** Residual quantisation steps; low = coarse, only strong edges survive. */
  residualQuant: number;

  /** Draw the motion field instead of the picture. */
  debugMotion: boolean;
  /** Pixels per frame that map to full brightness in the debug view. */
  debugScale: number;

  /** Scale of the frame buffers used by the feedback chain (0.1 - 1). */
  resolutionScale: number;
  /** Show the iFrame / pFrame / depth debug canvases. */
  debugFrames: boolean;
}

export interface DataMoshOptions extends DataMoshSettings {
  camera: THREE.Camera;
}

/**
 * Datamosh effect: reprojects its own previous output with macroblock quantised
 * motion vectors, and adds the residual of the incoming picture on top.
 *
 * Two motion vector sources are available. The default one is the screen space
 * velocity buffer produced by `VelocityPass`, which measures every movement in
 * the scene, camera and objects alike. The other is the camera reprojection
 * computed in the shader from the depth buffer and the three matrices this
 * class maintains: it only knows about the camera, but it costs no extra render
 * pass, so it stays as a fallback. The two are alternatives, never summed - the
 * velocity buffer already contains the camera contribution.
 *
 * The reprojection path is also used wherever the velocity buffer has no
 * coverage, i.e. on background pixels no geometry was rasterised on.
 */
export class DataMoshEffect extends Effect {
  private camera: THREE.Camera;

  // Camera state of the previous frame. The full world matrix is kept rather
  // than a position/quaternion pair because the shader needs the whole
  // transform back, and re-composing it would only add rounding.
  private readonly previousMatrixWorld = new THREE.Matrix4();
  private readonly previousProjection = new THREE.Matrix4();
  private hasPreviousCamera = false;

  // Scratch objects, reused to avoid per frame allocations.
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchPosition = new THREE.Vector3();

  /** Depth texture handed over by the EffectPass, kept for the debug view. */
  public depthTexture: THREE.Texture | null = null;

  constructor({ camera, ...settings }: DataMoshOptions) {
    const uniforms = new Map<string, THREE.Uniform>([
      ["pFrame", new THREE.Uniform(null)],
      ["uVelocity", new THREE.Uniform(null)],
      ["uTime", new THREE.Uniform(0)],
      ["uRecover", new THREE.Uniform(1)],
      ["uKeyframe", new THREE.Uniform(0)],
      ["uHistoryResolution", new THREE.Uniform(new THREE.Vector2(1, 1))],
      ["uInvViewProjection", new THREE.Uniform(new THREE.Matrix4())],
      ["uPrevViewProjection", new THREE.Uniform(new THREE.Matrix4())],
      ["uPrevViewProjectionRot", new THREE.Uniform(new THREE.Matrix4())],
      ["uMotionSource", new THREE.Uniform(0)],
      ["uMotionGain", new THREE.Uniform(settings.motionGain)],
      ["uParallax", new THREE.Uniform(settings.parallax)],
      ["uBlockSize", new THREE.Uniform(settings.blockSize)],
      ["uBlockiness", new THREE.Uniform(settings.blockiness)],
      ["uFrozenBlocks", new THREE.Uniform(settings.frozenBlocks)],
      ["uLostLayers", new THREE.Uniform(settings.lostLayers)],
      ["uLostLife", new THREE.Uniform(settings.lostLife)],
      ["uLostScale", new THREE.Uniform(settings.lostScale)],
      ["uLostAspect", new THREE.Uniform(settings.lostAspect)],
      ["uLostVariance", new THREE.Uniform(settings.lostVariance)],
      ["uMvPrecision", new THREE.Uniform(settings.mvPrecision)],
      ["uSkipThreshold", new THREE.Uniform(settings.skipThreshold)],
      ["uMismatch", new THREE.Uniform(settings.mismatch)],
      ["uResidualGain", new THREE.Uniform(settings.residualGain)],
      ["uResidualQuant", new THREE.Uniform(settings.residualQuant)],
      ["uDebugMotion", new THREE.Uniform(0)],
      ["uDebugScale", new THREE.Uniform(settings.debugScale)],
    ]);

    super("DataMosh", mainImageShader, {
      uniforms,
      // The effect replaces the image entirely; it also needs the scene depth,
      // which is what makes the EffectPass ask the composer for a depth texture
      // (and gives the shader readDepth / getViewZ / cameraNear / cameraFar).
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.DEPTH,
    });

    this.camera = camera;
  }

  setPFrameTexture(texture: THREE.Texture): void {
    this.uniforms.get("pFrame")!.value = texture;
  }

  setVelocityTexture(texture: THREE.Texture): void {
    this.uniforms.get("uVelocity")!.value = texture;
  }

  /**
   * The history and velocity textures can be smaller than the frame the pass
   * decodes. The Catmull-Rom taps and the residual's low-pass reads position
   * themselves in texels of *those* textures, so they need the real size, not
   * the pass resolution.
   */
  setHistoryResolution(width: number, height: number): void {
    (this.uniforms.get("uHistoryResolution")!.value as THREE.Vector2).set(width, height);
  }

  /**
   * Marks the current frame as a keyframe (I-frame): the decoder throws away
   * its prediction and shows the picture it was just handed, which is what
   * makes a finite GOP pump instead of drifting forever.
   */
  setKeyframeRefresh(active: boolean): void {
    this.uniforms.get("uKeyframe")!.value = active ? 1 : 0;
  }

  /**
   * Recovery factor: 0 = fully moshed, 1 = clean image, in between = the tail
   * of a gesture fading out.
   *
   * It is computed on the CPU, once per frame, by the manager. It used to be
   * derived inside the shader from `performance.now()`, the release timestamp
   * and the fade duration, all pushed through React state. That put the one
   * thing that has to be reliable - the picture coming back - behind three
   * things that are not guaranteed to be in step with the render loop: a React
   * commit, a uniform upload and 32 bit float arithmetic on an unbounded clock.
   */
  setRecovery(recover: number): void {
    this.uniforms.get("uRecover")!.value = THREE.MathUtils.clamp(recover, 0, 1);
  }

  /**
   * Density of the lost-vector regions, driven per frame by the manager rather
   * than by the settings: it is held at 0 for the first stretch of a gesture,
   * and the panel knows nothing about gestures.
   */
  setLostDensity(density: number): void {
    this.uniforms.get("uFrozenBlocks")!.value = density;
  }

  /** Called by the EffectPass with the composer's depth texture. */
  setDepthTexture(
    depthTexture: THREE.Texture,
    depthPacking?: THREE.DepthPackingStrategies,
  ): void {
    super.setDepthTexture(depthTexture, depthPacking);
    this.depthTexture = depthTexture;
  }

  /**
   * Records the camera transform of this frame so the next one can reproject
   * against it.
   *
   * Must run on *every* frame, exactly like its counterpart on the velocity
   * pass: skipping it while the effect is idle would make the first frame of a
   * gesture measure against a transform from an arbitrarily long time ago and
   * produce one huge, wrong vector. Calling it a second time right after a cut
   * is also how the jump itself is kept out of the motion field.
   */
  capturePreviousState(): void {
    this.previousMatrixWorld.copy(this.camera.matrixWorld);
    this.previousProjection.copy(this.camera.projectionMatrix);
    this.hasPreviousCamera = true;
  }

  update(): void {
    this.uniforms.get("uTime")!.value = performance.now();
    this.updateReprojectionMatrices();
  }

  /**
   * Feeds the shader the three matrices it needs to answer "where was this
   * point one frame ago".
   *
   * The previous transform is handed over twice: complete, and with its
   * translation replaced by the current camera position. Reprojecting a point
   * with both and taking the difference isolates the parallax exactly, which is
   * what makes `parallax` a physically meaningful weight rather than a fudge
   * factor - and it needs no small angle approximation, so roll and combined
   * movements come out right.
   */
  private updateReprojectionMatrices(): void {
    const camera = this.camera;

    // (P * V)^-1 = V^-1 * P^-1, and V^-1 is the camera's world matrix.
    (this.uniforms.get("uInvViewProjection")!.value as THREE.Matrix4)
      .copy(camera.matrixWorld)
      .multiply(camera.projectionMatrixInverse);

    const previousViewProjection = this.uniforms.get("uPrevViewProjection")!
      .value as THREE.Matrix4;
    const previousViewProjectionRot = this.uniforms.get(
      "uPrevViewProjectionRot",
    )!.value as THREE.Matrix4;

    // Without a previous frame to compare against (first frame, or the frame
    // right after a cut) the previous transform is the current one, which
    // yields exactly zero motion instead of a delta against stale data.
    const matrixWorld = this.hasPreviousCamera
      ? this.previousMatrixWorld
      : camera.matrixWorld;
    const projection = this.hasPreviousCamera
      ? this.previousProjection
      : camera.projectionMatrix;

    previousViewProjection.multiplyMatrices(
      projection,
      this.scratchMatrix.copy(matrixWorld).invert(),
    );

    camera.getWorldPosition(this.scratchPosition);
    this.scratchMatrix.copy(matrixWorld).setPosition(this.scratchPosition);
    previousViewProjectionRot.multiplyMatrices(
      projection,
      this.scratchMatrix.invert(),
    );
  }

  /** Pushes the settings into the uniforms. */
  applySettings(settings: DataMoshSettings): void {
    this.uniforms.get("uMotionSource")!.value =
      settings.motionSource === "velocity" ? 1 : 0;
    this.uniforms.get("uMotionGain")!.value = settings.motionGain;
    this.uniforms.get("uParallax")!.value = settings.parallax;
    this.uniforms.get("uBlockSize")!.value = settings.blockSize;
    this.uniforms.get("uBlockiness")!.value = settings.blockiness;
    this.uniforms.get("uFrozenBlocks")!.value = settings.frozenBlocks;
    this.uniforms.get("uLostLayers")!.value = settings.lostLayers;
    this.uniforms.get("uLostLife")!.value = settings.lostLife;
    this.uniforms.get("uLostScale")!.value = settings.lostScale;
    this.uniforms.get("uLostAspect")!.value = settings.lostAspect;
    this.uniforms.get("uLostVariance")!.value = settings.lostVariance;
    this.uniforms.get("uMvPrecision")!.value = settings.mvPrecision;
    this.uniforms.get("uSkipThreshold")!.value = settings.skipThreshold;
    this.uniforms.get("uMismatch")!.value = settings.mismatch;
    this.uniforms.get("uResidualGain")!.value = settings.residualGain;
    this.uniforms.get("uResidualQuant")!.value = settings.residualQuant;
    this.uniforms.get("uDebugMotion")!.value = settings.debugMotion ? 1 : 0;
    this.uniforms.get("uDebugScale")!.value = settings.debugScale;
  }
}
