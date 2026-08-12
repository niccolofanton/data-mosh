import {
  BloomEffect,
  CopyPass,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  KernelSize,
  Pass,
  RenderPass,
} from "postprocessing";
import * as THREE from "three";
import { DataMoshEffect, DataMoshSettings } from "./data-moshing-effect";
import { supportsVelocityBuffer, VelocityPass } from "./velocity-pass";
import { moshInput } from "../mosh-input";
import { sceneCut } from "../scene-cut";
import { OpticsSensorEffect } from "../found-footage/optics-sensor-effect";
import { SignalEffect } from "../found-footage/signal-effect";
import { CameraSettings } from "../found-footage/settings";
import { DebugFrameView } from "../../../debug-canvas/debug-canvas";

/**
 * Owns the whole post-processing chain of the datamosh scene.
 *
 * Pass order and why:
 *
 *   RenderPass            clean render of the scene
 *   VelocityPass          screen space motion vectors of camera *and* objects,
 *                         into its own half float target. Disabled unless the
 *                         effect is actually warping, because it draws the
 *                         scene a second time.
 *   EffectPass(Optics)    lens and sensor: distortion, chromatic aberration,
 *                         rolling shutter or CCD smear, the automatics, noise.
 *                         Before the mosh on purpose - in a real camera all of
 *                         this happens before the encoder, so the codec gets to
 *                         compress an image that is already dirty. Noise a codec
 *                         has chewed on reads as a sensor; noise added at the
 *                         end reads as a filter.
 *   CopyPass  (keyframe)  disabled, enabled for a single frame when the trigger
 *                         goes down: that one copy *is* the I-frame. Removing
 *                         the keyframes from a video means never refreshing it
 *                         again, so by default it stays frozen for the whole
 *                         gesture; a non-zero keyframe interval re-enables it
 *                         periodically, which is the finite GOP case.
 *   EffectPass(DataMosh)  reprojects the previous output with block quantised
 *                         motion vectors
 *   CopyPass  (feedback)  saves the result: this is the P-frame chain the next
 *                         frame reads from
 *   EffectPass(Tape)      playback side: timebase jitter, head switching,
 *                         dropout, combing, chroma bleed, dot crawl, and the
 *                         burnt-in OSD. After the feedback copy on purpose -
 *                         these artifacts belong to the tape being played, not
 *                         to the picture being recorded, so they must not be
 *                         fed back into the prediction chain.
 *   CopyPass  (display)   blits the result to the canvas
 *
 * The display pass looks redundant (it draws exactly what the composer already
 * has in its input buffer) and the custom "DisplayEffect" it replaces really
 * was, but a terminal pass is structurally required: `autoRenderToScreen` marks
 * the last pass as the one drawing to the canvas, and a CopyPass that renders
 * to the screen writes to the canvas *instead of* its own target, which would
 * silently break the feedback capture. A plain CopyPass is the cheapest thing
 * that can sit there.
 */
export class DataMoshManager {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly effect: DataMoshEffect;
  private readonly moshPass: EffectPass;
  private readonly velocityPass: VelocityPass;
  private readonly keyframePass: CopyPass;
  private readonly feedbackPass: CopyPass;
  private readonly keyframeTarget: THREE.WebGLRenderTarget;
  private readonly feedbackTarget: THREE.WebGLRenderTarget;
  private readonly velocitySupported: boolean;

  private readonly fxaa: FXAAEffect;
  private readonly fxaaPass: EffectPass;
  private readonly bloom: BloomEffect;
  private readonly bloomPass: EffectPass;
  private readonly optics: OpticsSensorEffect;
  private readonly opticsPass: EffectPass;
  private readonly signal: SignalEffect;
  private readonly signalPass: EffectPass;
  private readonly trailPass: CopyPass;
  private readonly trailTarget: THREE.WebGLRenderTarget;

  private settings: DataMoshSettings;
  private cameraSettings: CameraSettings;
  private readonly camera: THREE.Camera;
  private width = 1;
  private height = 1;
  private wasActive = false;
  private lastKeyframeTime = 0;
  private debugViews: DebugFrameView[] | null = null;

  constructor(
    private readonly gl: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: DataMoshSettings,
    cameraSettings: CameraSettings,
  ) {
    this.settings = settings;
    this.cameraSettings = cameraSettings;
    this.camera = camera;

    this.composer = new EffectComposer(gl);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // FXAA, and first in the chain rather than last, which is where an
    // antialiasing pass normally goes.
    //
    // Two reasons, and the second is the important one. It stands in for the
    // optics: no lens resolves an infinitely sharp edge onto a sensor, so the
    // softening belongs on the same side of the encoder as the rest of the
    // camera. And running it at the end would round off the macroblock edges -
    // the one thing in this picture that has to stay hard, because a datamosh
    // is *made* of tiles disagreeing with their neighbours along straight
    // vertical and horizontal seams. Antialiasing those away would smooth out
    // the effect itself and leave only the smear.
    //
    // FXAA rather than SMAA: it is a single pass over luminance with no lookup
    // textures and no edge/blend-weight intermediates, which at 720p is
    // effectively free.
    this.fxaa = new FXAAEffect();
    this.fxaaPass = new EffectPass(camera, this.fxaa);
    this.composer.addPass(this.fxaaPass);

    this.velocitySupported = supportsVelocityBuffer(gl);
    if (!this.velocitySupported) {
      console.warn(
        "[DataMosh] No renderable half float target available, falling back to camera-only motion vectors.",
      );
    }
    this.velocityPass = new VelocityPass(scene, camera);
    this.velocityPass.enabled = false;
    this.composer.addPass(this.velocityPass);

    // Glare belongs to the lens, so it goes in before the sensor stage and well
    // before the encoder: the bloom is part of what gets compressed, not
    // something painted over the compressed result. Its own pass rather than
    // being chained into the optics pass, because the optics shader samples the
    // input buffer directly for the distortion and would otherwise be reading a
    // frame without the glow in it.
    this.bloom = new BloomEffect({
      intensity: cameraSettings.bloom.intensity,
      luminanceThreshold: cameraSettings.bloom.threshold,
      luminanceSmoothing: cameraSettings.bloom.smoothing,
      mipmapBlur: true,
      kernelSize: KernelSize.LARGE,
    });
    this.bloomPass = new EffectPass(camera, this.bloom);
    this.composer.addPass(this.bloomPass);

    // The velocity pass reads the scene, not the colour buffer, so it has to
    // run before the optics stage distorts the picture - otherwise it would be
    // measuring a frame nobody is going to see.
    this.optics = new OpticsSensorEffect(camera, cameraSettings.optics);
    this.opticsPass = new EffectPass(camera, this.optics);
    this.composer.addPass(this.opticsPass);

    // Both feedback targets are owned here (autoResize off) so the resolution
    // scale can shrink them independently from the composer buffers.
    this.keyframeTarget = createFrameTarget("DataMosh.Keyframe");
    this.feedbackTarget = createFrameTarget("DataMosh.Feedback");

    this.keyframePass = new CopyPass(this.keyframeTarget, false);
    this.keyframePass.enabled = false;
    this.composer.addPass(this.keyframePass);

    this.effect = new DataMoshEffect({ camera, ...settings });
    this.effect.setPFrameTexture(this.feedbackTarget.texture);
    this.effect.setVelocityTexture(this.velocityPass.renderTarget.texture);
    this.moshPass = new EffectPass(camera, this.effect);
    this.composer.addPass(this.moshPass);

    this.feedbackPass = new CopyPass(this.feedbackTarget, false);
    this.composer.addPass(this.feedbackPass);

    this.signal = new SignalEffect(cameraSettings.signal);
    this.signalPass = new EffectPass(camera, this.signal);
    this.composer.addPass(this.signalPass);

    // The trail is this effect's own previous output, so the copy has to sit
    // immediately after it and before anything else touches the buffer.
    this.trailTarget = createFrameTarget("Camera.Trail");
    this.signal.setTrailTexture(this.trailTarget.texture);
    this.trailPass = new CopyPass(this.trailTarget, false);
    this.composer.addPass(this.trailPass);

    // The display pass never uses its own target (it always renders to the
    // canvas), so it keeps the 1x1 one it is born with.
    this.composer.addPass(new CopyPass(undefined, false));

    separateStableDepthTexture(this.composer);

    const size = gl.getDrawingBufferSize(new THREE.Vector2());
    this.setSize(size.width, size.height);
    this.applySettings();
  }

  /** Renders the whole chain. Must be called from a useFrame with priority. */
  render(deltaTime: number): void {
    const settings = this.settings;
    const now = performance.now();

    // The trigger is read straight from the shared store rather than from the
    // React settings object. The gesture state changes at input rate and has to
    // be in step with the render loop, not with whenever React gets round to
    // committing an effect: a late commit used to mean the picture kept moshing
    // after the release. Everything below therefore derives from `recover`, a
    // single value recomputed here on every frame.
    const { pressed, lastReleaseTime } = moshInput.getSnapshot();
    const active = settings.effectEnabled && pressed;

    const recover = !settings.effectEnabled
      ? 1
      : pressed
        ? 0
        : lastReleaseTime < 0
          ? 1
          : THREE.MathUtils.clamp(
              (now - lastReleaseTime) / Math.max(settings.fadeDuration, 1),
              0,
              1,
            );

    this.effect.setRecovery(recover);

    // The keyframe is captured on the frame the trigger goes down, from the
    // clean render. After that the decoder is on its own, unless a finite GOP
    // was asked for.
    const gestureStart = active && !this.wasActive;
    const gopRefresh =
      active &&
      !gestureStart &&
      settings.keyframeInterval > 0 &&
      now - this.lastKeyframeTime >= settings.keyframeInterval;

    if (gestureStart || gopRefresh) {
      this.lastKeyframeTime = now;
    }
    // Nothing samples the keyframe target. The I-frame is expressed entirely by
    // the `uKeyframe > 0.5 -> outputColor = inputColor` branch in the shader;
    // this copy exists only to fill the debug preview, so off-screen it is a
    // full-resolution blit on the one frame that also performs a scene cut -
    // the frame least able to afford it.
    this.keyframePass.enabled =
      (gestureStart || gopRefresh) && settings.debugFrames;
    // Only the periodic keyframes reset the picture: the first one is the
    // reference the gesture starts drifting away from, and flashing it would
    // just make the trigger blink.
    this.effect.setKeyframeRefresh(gopRefresh);

    // A bloom is a duplicated P-frame: one motion field, re-applied to its own
    // result. So the field is measured on the frame the gesture starts and then
    // held - the pass simply stops running and its target keeps what it last
    // rasterised, which is cheaper than copying it somewhere safe and is
    // exactly the semantics wanted. A melt instead keeps measuring, because its
    // whole point is that the vectors stay right while the picture goes wrong.
    //
    // Either way the gate is `recover`, the same value the shader uses: no
    // warp, no need for motion vectors, and the pass cannot outlive the fade.
    const moshing = recover < 1;
    const bloom = settings.moshMode === "bloom";

    // Either debug view needs the buffer populated even when nothing is
    // moshing, otherwise the velocity preview is just a black rectangle until
    // the trigger is held - which is exactly when it is least useful to look at.
    const debugging =
      settings.effectEnabled && (settings.debugFrames || settings.debugMotion);

    this.velocityPass.enabled =
      settings.motionSource === "velocity" &&
      this.velocitySupported &&
      (debugging || (bloom ? gestureStart : moshing));
    this.effect.setMotionFrozen(bloom && moshing && !gestureStart);

    this.wasActive = active;

    // The mosh samples the velocity field and the depth buffer, neither of
    // which went through the optics stage, while working on a picture that did.
    // Handing it the lens keeps the three in the same coordinates. Zeros when
    // the stage is switched off, which is the identity remap.
    this.effect.setLensRemap(
      this.opticsPass.enabled ? this.optics.barrel : 0,
      this.opticsPass.enabled ? this.optics.skew : 0,
    );

    // A fully recovered picture is a bit-exact passthrough: the shader's first
    // statement is `outputColor = inputColor; return;`, and the pass blends with
    // BlendFunction.SRC, so the whole full-screen pass exists to reproduce its
    // own input. This is a press-and-hold gesture, so that is the overwhelming
    // majority of frames.
    //
    // The feedback copy deliberately keeps running: with the mosh pass off it
    // copies the identical image, which is what keeps `pFrame` current for the
    // first frame of the next gesture.
    this.moshPass.enabled =
      settings.effectEnabled && (moshing || settings.debugMotion);

    // The datamosh shader is the only thing in the chain that samples depth, so
    // when it is not running the composer's per-frame full-screen depth blit is
    // copying a buffer nobody will read. The debug preview reads it too.
    this.renderPass.needsDepthBlit =
      this.moshPass.enabled || settings.debugFrames;

    this.composer.render(deltaTime);

    this.keyframePass.enabled = false;
    this.effect.setKeyframeRefresh(false);

    // Unconditional, even when the velocity pass is off: the transforms of this
    // frame are what the *next* one measures against, and skipping them would
    // make the first frame of a gesture compare against a stale matrix.
    this.velocityPass.capturePreviousState();
    this.effect.capturePreviousState();

    // The cut has to happen *after* the render, and this is the only point in
    // the frame where that is true of everything it depends on:
    //
    //   - the keyframe copy that just ran holds the outgoing shot, which is
    //     what an I-frame is; cutting first would have captured the incoming
    //     one instead;
    //   - the feedback target holds the outgoing picture too, so the next frame
    //     predicts from a shot that is already gone - the whole point;
    //   - re-capturing the camera state right after the jump keeps the jump
    //     itself out of the motion field. Without it the next frame would
    //     measure the teleport as one enormous vector and the picture would be
    //     thrown off screen in a single step, instead of being dragged by the
    //     movement of the new shot.
    //
    // Every keyframe cuts, not just the first one. A keyframe *is* where a shot
    // begins - that is what makes it an I-frame rather than a P-frame - so a
    // finite GOP is a sequence of shots, and refreshing the reference picture
    // without changing what it is a picture of would restate the same shot over
    // and over. With an interval set, the gesture becomes a series of melts,
    // each one dragging the shot that has just been replaced.
    //
    // Only on melt: a bloom lives inside a single shot by definition.
    if (
      (gestureStart || gopRefresh) &&
      settings.sceneCut &&
      !bloom &&
      sceneCut.run()
    ) {
      this.camera.updateMatrixWorld(true);
      this.velocityPass.capturePreviousState();
      this.effect.capturePreviousState();
    }

    this.updateDebugViews();
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);

    this.composer.setSize(this.width, this.height, false);
    // The trail is a full resolution history of the final image, so it follows
    // the display size rather than the feedback chain's resolution scale.
    this.trailTarget.setSize(this.width, this.height);
    this.applyResolutionScale();

    // The debug previews bake the aspect ratio into their canvas.
    if (this.debugViews) {
      this.disposeDebugViews();
      this.syncDebugViews();
    }
  }

  updateSettings(settings: DataMoshSettings, cameraSettings: CameraSettings): void {
    const previous = this.settings;
    this.settings = settings;
    this.cameraSettings = cameraSettings;

    this.applySettings();

    if (settings.resolutionScale !== previous.resolutionScale) {
      this.applyResolutionScale();
    }
  }

  dispose(): void {
    this.disposeDebugViews();
    // Disposes every pass (and therefore every render target owned by them),
    // the ping-pong buffers and the depth target.
    this.composer.dispose();
  }

  private applySettings(): void {
    this.effect.applySettings(this.settings);

    const camera = this.cameraSettings;
    this.optics.applySettings(camera.optics);
    // With the camera off but the outline on, the signal stage still has to
    // run - it is what draws the overlay - so it is fed a neutral set instead
    // of the camera's. Otherwise ticking a debug checkbox would switch on the
    // grade, the chroma bleed and the trail as a side effect.
    this.signal.applySettings(camera.enabled ? camera.signal : NEUTRAL_SIGNAL);
    this.signal.setLostDebug({
      enabled: this.settings.debugLost,
      density: this.settings.frozenBlocks,
      layers: this.settings.lostLayers,
      life: this.settings.lostLife,
      scale: this.settings.lostScale,
      aspect: this.settings.lostAspect,
      variance: this.settings.lostVariance,
    });
    this.bloom.intensity = camera.bloom.intensity;
    this.bloom.luminanceMaterial.threshold = camera.bloom.threshold;
    this.bloom.luminanceMaterial.smoothing = camera.bloom.smoothing;

    // Disabling the passes is the whole "effect enabled" story: no teardown, no
    // re-initialisation, and re-enabling picks up exactly where it left off.
    const enabled = this.settings.effectEnabled;
    this.moshPass.enabled = enabled;
    this.feedbackPass.enabled = enabled;

    this.fxaaPass.enabled = this.settings.antialias;
    this.bloomPass.enabled = camera.enabled && camera.bloom.intensity > 0;
    this.opticsPass.enabled = camera.enabled;
    // The lost-vector outline is drawn by this stage, so it has to run for the
    // debug view even with the camera simulation switched off.
    this.signalPass.enabled = camera.enabled || this.settings.debugLost;
    // No point paying for the copy when nothing reads the trail.
    this.trailPass.enabled = camera.enabled && camera.signal.persistence > 0;

    this.syncDebugViews();
  }

  private applyResolutionScale(): void {
    const scale = THREE.MathUtils.clamp(this.settings.resolutionScale, 0.1, 1);
    const width = Math.max(1, Math.round(this.width * scale));
    const height = Math.max(1, Math.round(this.height * scale));

    this.keyframeTarget.setSize(width, height);
    this.feedbackTarget.setSize(width, height);
    this.velocityPass.setResolutionScale(scale);
  }

  private syncDebugViews(): void {
    const wanted = this.settings.debugFrames && this.settings.effectEnabled;

    if (wanted && !this.debugViews) {
      const aspect = this.width / this.height;
      this.debugViews = [
        new DebugFrameView("iFrame (keyframe)", 0, aspect),
        new DebugFrameView("pFrame (feedback)", 1, aspect),
        new DebugFrameView("depth", 2, aspect, "depth"),
        new DebugFrameView("velocity", 3, aspect, "velocity"),
      ];
    } else if (!wanted) {
      this.disposeDebugViews();
    }
  }

  private disposeDebugViews(): void {
    this.debugViews?.forEach((view) => view.dispose());
    this.debugViews = null;
  }

  private updateDebugViews(): void {
    if (!this.debugViews) return;

    const now = performance.now();
    const camera = this.camera as THREE.PerspectiveCamera;

    this.debugViews[0].update(this.gl, this.keyframeTarget.texture, now);
    this.debugViews[1].update(this.gl, this.feedbackTarget.texture, now);
    this.debugViews[2].update(this.gl, this.effect.depthTexture, now, camera);
    this.debugViews[3].update(
      this.gl,
      this.velocityPass.renderTarget.texture,
      now,
    );
  }
}

/** Signal stage that changes nothing: identity grade, no artifacts. */
const NEUTRAL_SIGNAL = {
  chromaBleed: 0,
  chromaDelay: 0,
  persistence: 0,
  persistenceBias: 0,
  lift: 0,
  liftTint: "#ffffff",
  shoulder: 0,
  contrast: 1,
  saturation: 1,
  tint: "#ffffff",
  vignette: 0,
  grain: 0,
};

const createFrameTarget = (name: string): THREE.WebGLRenderTarget => {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.name = name;
  target.texture.generateMipmaps = false;
  return target;
};

/** Shape of the composer internals this module has to reach into. */
interface ComposerDepthInternals {
  depthTexture: THREE.DepthTexture | null;
  depthRenderTarget: THREE.WebGLRenderTarget | null;
  passes: Pass[];
}

/**
 * Works around a bug in postprocessing's depth plumbing.
 *
 * As soon as a pass asks for the scene depth (here the EffectPass, because the
 * effect declares `EffectAttribute.DEPTH`), `EffectComposer.createDepthTexture`
 * attaches a DepthTexture to the input buffer and creates a second "stable"
 * target whose depth attachment the passes actually sample. The stable texture
 * is built with `depthTexture.clone()` - and `THREE.Texture.copy` copies the
 * `Source` by reference. Three keys the GL texture object on the source (plus
 * the sampler parameters, identical in a clone), so both attachments end up
 * being the *same* GL texture, and the per frame
 * `blitFramebuffer(inputBuffer -> depthRenderTarget)` fails with
 *
 *   GL_INVALID_OPERATION: glBlitFramebuffer: Read and write depth stencil
 *   attachments cannot be the same image
 *
 * once per frame, forever. Still present in the latest 6.x (6.39.4), which
 * clones the texture three times over.
 *
 * Giving the stable target a DepthTexture of its own is enough: a fresh
 * instance owns a fresh `Source`, so read and write attachments are finally two
 * different images. The guard makes this a no-op on a version that fixes the
 * bug upstream.
 */
const separateStableDepthTexture = (composer: EffectComposer): void => {
  const internals = composer as unknown as ComposerDepthInternals;
  const inputDepthTexture = internals.depthTexture;
  const depthRenderTarget = internals.depthRenderTarget;
  const stable = depthRenderTarget?.depthTexture;

  if (!inputDepthTexture || !depthRenderTarget || !stable) return;
  if (stable.source !== inputDepthTexture.source) return;

  const replacement = new THREE.DepthTexture(
    depthRenderTarget.width,
    depthRenderTarget.height,
  );
  replacement.name = "DataMosh.StableDepth";
  replacement.format = stable.format;
  replacement.type = stable.type;

  depthRenderTarget.depthTexture = replacement;
  for (const pass of internals.passes) {
    pass.setDepthTexture(replacement);
  }

};
