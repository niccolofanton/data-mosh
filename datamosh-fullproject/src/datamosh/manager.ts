import {
  CopyPass,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  Pass,
  RenderPass,
} from "postprocessing";
import * as THREE from "three";
import { DataMoshEffect, DataMoshSettings } from "./effect";
import { supportsVelocityBuffer, VelocityPass } from "./velocity-pass";
import { moshInput } from "@/state/mosh-input";
import { sceneCut } from "@/state/scene-cut";
import { DebugFrameView } from "./debug-view";

/**
 * Owns the whole post-processing chain of the datamosh scene.
 *
 * Pass order and why:
 *
 *   RenderPass            clean render of the scene
 *   EffectPass(FXAA)      softens the render before the encoder sees it
 *   VelocityPass          screen space motion vectors of camera *and* objects,
 *                         into its own half float target. Disabled unless the
 *                         effect is actually warping, because it draws the
 *                         scene a second time.
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
/**
 * How long a gesture runs before the lost sectors appear, in milliseconds.
 *
 * A stream does not start dropping packets the instant it starts decoding. The
 * gesture opens on a clean smear and the packet loss arrives on top of it,
 * which also keeps the frozen blocks from being the first thing the eye reads.
 */
const LOST_SECTOR_DELAY = 300;

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

  private readonly fxaaPass: EffectPass;

  private settings: DataMoshSettings;
  private readonly camera: THREE.Camera;
  private width = 1;
  private height = 1;
  private wasActive = false;
  private lastKeyframeTime = 0;
  private gestureStartTime = -Infinity;
  private debugViews: DebugFrameView[] | null = null;

  constructor(
    private readonly gl: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: DataMoshSettings,
  ) {
    this.settings = settings;
    this.camera = camera;

    this.velocitySupported = supportsVelocityBuffer(gl);
    if (!this.velocitySupported) {
      console.warn(
        "[DataMosh] No renderable half float target available, falling back to camera-only motion vectors.",
      );
    }

    // The composer's own buffers have to match the feedback targets: CopyPass
    // re-types the target it copies into from the composer's frame buffer
    // type, so an 8-bit composer would silently undo the half-float history.
    this.composer = new EffectComposer(gl, {
      frameBufferType: this.velocitySupported ? THREE.HalfFloatType : THREE.UnsignedByteType,
    });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // FXAA, and first in the chain rather than last, which is where an
    // antialiasing pass normally goes.
    //
    // Two reasons, and the second is the important one. It stands in for the
    // optics: no lens resolves an infinitely sharp edge onto a sensor, so the
    // softening belongs upstream of the encoder. And running it at the end
    // would round off the macroblock edges - the one thing in this picture
    // that has to stay hard, because a datamosh is *made* of tiles disagreeing
    // with their neighbours along straight vertical and horizontal seams.
    // Antialiasing those away would smooth out the effect itself and leave
    // only the smear.
    //
    // FXAA rather than SMAA: it is a single pass over luminance with no lookup
    // textures and no edge/blend-weight intermediates, which at 720p is
    // effectively free.
    this.fxaaPass = new EffectPass(camera, new FXAAEffect());
    this.composer.addPass(this.fxaaPass);

    this.velocityPass = new VelocityPass(scene, camera);
    this.velocityPass.enabled = false;
    this.composer.addPass(this.velocityPass);

    // Both feedback targets are owned here (autoResize off) so the resolution
    // scale can shrink them independently from the composer buffers.
    // Match the article demos: the prediction chain is a half-float buffer on
    // capable hardware. Repeated round trips through an 8-bit target quantise
    // dark linear values until they collapse to black. The camera-only fallback
    // remains usable on devices that cannot render to half-float textures.
    const frameType = this.velocitySupported
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;
    this.keyframeTarget = createFrameTarget("DataMosh.Keyframe", frameType);
    this.feedbackTarget = createFrameTarget("DataMosh.Feedback", frameType);

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

    // The display pass never uses its own target (it always renders to the
    // canvas), so it keeps the 1x1 one it is born with.
    this.composer.addPass(new CopyPass(undefined, false));

    separateStableDepthTexture(this.composer);

    // CSS pixels, not the drawing buffer: setSize hands them straight to the
    // composer, which resizes the renderer with them.
    const size = gl.getSize(new THREE.Vector2());
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
    if (gestureStart) {
      this.gestureStartTime = now;
    }

    // Written here rather than in applySettings, because the delay is a
    // property of the gesture and the panel knows nothing about gestures. The
    // release does not cancel it: the sectors stay through the recovery fade.
    this.effect.setLostDensity(
      now - this.gestureStartTime >= LOST_SECTOR_DELAY
        ? settings.frozenBlocks
        : 0,
    );

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

    // The gate is `recover`, the same value the shader uses: no warp, no need
    // for motion vectors, and the pass cannot outlive the fade.
    const moshing = recover < 1;

    // Either debug view needs the buffer populated even when nothing is
    // moshing, otherwise the velocity preview is just a black rectangle until
    // the trigger is held - which is exactly when it is least useful to look at.
    const debugging =
      settings.effectEnabled && (settings.debugFrames || settings.debugMotion);

    this.velocityPass.enabled =
      settings.motionSource === "velocity" &&
      this.velocitySupported &&
      (debugging || moshing);

    this.wasActive = active;

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
    if ((gestureStart || gopRefresh) && settings.sceneCut && sceneCut.run()) {
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
    this.applyResolutionScale();

    // The debug previews bake the aspect ratio into their canvas.
    if (this.debugViews) {
      this.disposeDebugViews();
      this.syncDebugViews();
    }
  }

  updateSettings(settings: DataMoshSettings): void {
    const previous = this.settings;
    this.settings = settings;

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

    // Disabling the passes is the whole "effect enabled" story: no teardown, no
    // re-initialisation, and re-enabling picks up exactly where it left off.
    const enabled = this.settings.effectEnabled;
    this.moshPass.enabled = enabled;
    this.feedbackPass.enabled = enabled;

    this.fxaaPass.enabled = this.settings.antialias;

    this.syncDebugViews();
  }

  /**
   * Both frame targets are measured off the composer's own buffer, never off
   * the size handed to `setSize` - which arrives in CSS pixels, from r3f's
   * measured rect. Everything else in the chain is sized in drawing-buffer
   * pixels, so on any display with a pixel ratio above 1 a feedback target
   * built from CSS pixels is smaller than the picture flowing through it, and
   * the loop downsamples and upsamples once per frame. Bilinear down then up is
   * not the identity: a perfectly still frame dissolves on its own, which reads
   * as the effect losing resolution rather than as the bug it is.
   */
  private applyResolutionScale(): void {
    const scale = THREE.MathUtils.clamp(this.settings.resolutionScale, 0.1, 1);
    const buffer = this.composer.inputBuffer;
    const width = Math.max(1, Math.round(buffer.width * scale));
    const height = Math.max(1, Math.round(buffer.height * scale));

    this.keyframeTarget.setSize(width, height);
    this.feedbackTarget.setSize(width, height);
    // The decode pass still runs full size; only its sources shrink. The
    // shader positions its Catmull-Rom and residual taps in *their* texels.
    this.effect.setHistoryResolution(width, height);
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

const createFrameTarget = (
  name: string,
  type: THREE.TextureDataType,
): THREE.WebGLRenderTarget => {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type,
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
