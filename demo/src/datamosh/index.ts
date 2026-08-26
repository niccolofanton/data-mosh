import { CopyPass, EffectComposer, EffectPass, FXAAEffect, RenderPass } from 'postprocessing';
import * as THREE from 'three';
import { controls } from '../debug';
import { DataMoshEffect } from './effect';
import { VelocityPass } from './velocity-pass';

export { forgetPreviousMatrix } from './velocity-pass';

/**
 * How long a gesture runs before the lost sectors appear, in milliseconds.
 *
 * A stream does not start dropping packets the instant it starts decoding. The
 * gesture opens on a clean smear and the packet loss arrives on top of it,
 * which also keeps the frozen blocks from being the first thing the eye reads.
 */
const LOST_SECTOR_DELAY = 300;

/**
 * Owns the pipeline and decides, frame by frame, whether the decoder is running
 * clean or has had its keyframes taken away.
 */
export class DataMoshManager {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly effect: DataMoshEffect;
  private readonly moshPass: EffectPass;
  private readonly fxaaPass: EffectPass;
  private readonly velocityPass: VelocityPass;
  private readonly feedbackPass: CopyPass;
  private readonly feedbackTarget: THREE.WebGLRenderTarget;
  private readonly velocitySupported: boolean;

  private wasActive = false;
  private lastKeyframeTime = 0;
  private gestureStartTime = -Infinity;

  constructor(
    gl: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly input: { pressed: boolean; lastRelease: number },
    private readonly onCut: () => boolean,
  ) {
    this.velocitySupported =
      gl.extensions.has('EXT_color_buffer_half_float') || gl.extensions.has('EXT_color_buffer_float');
    if (!this.velocitySupported) console.warn('[DataMosh] No half float target: camera-only motion.');

    // The history feeds on its own output. At 8 bit, repeated round trips
    // quantise dark linear values until they collapse to black; half float
    // preserves them. The composer has to agree: CopyPass re-types the target
    // it copies into from the composer's frame buffer type, so an 8-bit
    // composer would silently undo the half-float history. Keep the camera-only
    // fallback available on hardware that cannot render to a half-float
    // attachment.
    const frameType = this.velocitySupported ? THREE.HalfFloatType : THREE.UnsignedByteType;

    this.composer = new EffectComposer(gl, { frameBufferType: frameType });
    this.renderPass = new RenderPass(scene, camera);
    this.fxaaPass = new EffectPass(camera, new FXAAEffect());
    this.velocityPass = new VelocityPass(scene, camera);

    this.feedbackTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: frameType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.feedbackTarget.texture.name = 'DataMosh.Feedback';
    this.feedbackTarget.texture.generateMipmaps = false;

    this.effect = new DataMoshEffect(camera);
    this.effect.set('pFrame', this.feedbackTarget.texture);
    this.effect.set('uVelocity', this.velocityPass.renderTarget.texture);
    this.moshPass = new EffectPass(camera, this.effect);
    this.feedbackPass = new CopyPass(this.feedbackTarget, false);

    // Render, antialias, measure motion, decode, then keep a copy of the result
    // as next frame's reference. The last pass is what reaches the screen —
    // without it the feedback copy would, and the loop would never close.
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.fxaaPass);
    this.composer.addPass(this.velocityPass);
    this.composer.addPass(this.moshPass);
    this.composer.addPass(this.feedbackPass);
    this.composer.addPass(new CopyPass(undefined, false));

    separateStableDepthTexture(this.composer);
    this.updateSettings();
  }

  render(deltaTime: number): void {
    const now = performance.now();
    const { pressed, lastRelease } = this.input;
    const active = controls.effectEnabled && pressed;

    // 0 while held, then climbing to 1 over the fade: how much of the honest
    // render is back. 1 means the effect contributes nothing.
    const recover =
      !controls.effectEnabled || (!pressed && lastRelease < 0)
        ? 1
        : pressed
          ? 0
          : THREE.MathUtils.clamp((now - lastRelease) / Math.max(controls.fadeDuration, 1), 0, 1);

    this.effect.set('uRecover', recover);

    // A gesture starts one GOP; if the interval is set, later keyframes punch
    // through it and partially repair the picture mid-gesture.
    const gestureStart = active && !this.wasActive;
    const gopRefresh =
      active &&
      !gestureStart &&
      controls.keyframeInterval > 0 &&
      now - this.lastKeyframeTime >= controls.keyframeInterval;

    if (gestureStart || gopRefresh) this.lastKeyframeTime = now;
    if (gestureStart) this.gestureStartTime = now;
    this.effect.set('uKeyframe', gopRefresh ? 1 : 0);

    // Written here rather than in applySettings, because the delay is a
    // property of the gesture and the panel knows nothing about gestures. The
    // release does not cancel it: the sectors stay through the recovery fade.
    this.effect.set(
      'uFrozenBlocks',
      now - this.gestureStartTime >= LOST_SECTOR_DELAY ? controls.frozenBlocks : 0,
    );

    const moshing = recover < 1;

    // The overlays draw from the vector field, so they need the pass running
    // even when there is nothing to decode.
    const overlays = controls.debugMotion || controls.showMotionArrows;

    this.velocityPass.enabled =
      this.velocitySupported && (moshing || (controls.effectEnabled && overlays));

    this.wasActive = active;

    // The overlays live inside the effect, so the pass has to run for them even
    // when there is nothing to decode.
    this.moshPass.enabled =
      controls.effectEnabled && (moshing || overlays || controls.showLostSectors);
    this.renderPass.needsDepthBlit = this.moshPass.enabled;

    this.composer.render(deltaTime);

    // The cut happens after the frame is on screen: the new shot is what the
    // next frame renders, while the feedback buffer still holds the old one.
    // That mismatch, decoded with the incoming shot's vectors, is the whole
    // trick — and capturing the post-cut state below keeps the camera jump
    // itself from ever becoming a vector.
    if ((gestureStart || gopRefresh) && controls.sceneCut && this.onCut()) {
      this.camera.updateMatrixWorld(true);
    }

    this.velocityPass.capturePreviousState();
    this.effect.capturePreviousState();
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(Math.max(1, width), Math.max(1, height), false);
    this.applyResolutionScale();
  }

  updateSettings(): void {
    this.effect.applySettings();

    this.feedbackPass.enabled = controls.effectEnabled;
    this.fxaaPass.enabled = controls.antialias;

    this.applyResolutionScale();
  }

  /**
   * The history and velocity textures at a fraction of the display resolution:
   * coarser, and cheaper. The decode pass itself still runs full size — only
   * its sources shrink — so the shader is told their real dimensions through
   * uHistoryResolution, or the Catmull-Rom taps would land on the wrong texels.
   *
   * Measured off the composer's own buffer, never off the CSS size handed to
   * setSize. Everything else in the chain is sized in drawing-buffer pixels, so
   * on any display with a pixel ratio above 1 a feedback target built from CSS
   * pixels is smaller than the picture flowing through it — and the loop then
   * downsamples and upsamples once per frame. Bilinear down then up is not the
   * identity, so a perfectly still frame dissolves on its own, which reads as
   * the effect losing resolution rather than as the bug it is.
   */
  private applyResolutionScale(): void {
    const scale = THREE.MathUtils.clamp(controls.resolutionScale, 0.1, 1);
    const { width, height } = this.composer.inputBuffer;

    this.feedbackTarget.setSize(
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
    );
    this.effect.setHistoryResolution(this.feedbackTarget.width, this.feedbackTarget.height);
    this.velocityPass.setResolutionScale(scale);
  }
}

/**
 * Workaround. The composer builds its stable depth texture by cloning the input
 * buffer's, and a cloned three texture shares the same GPU texture — so the
 * effect ends up reading the depth attachment it is writing through. WebGL
 * rejects the draw, and the mosh silently never appears. Giving the depth
 * target its own texture breaks the loop.
 */
const separateStableDepthTexture = (composer: EffectComposer): void => {
  const target = (composer as unknown as { depthRenderTarget?: THREE.WebGLRenderTarget | null })
    .depthRenderTarget;
  const stable = target?.depthTexture;
  const shared = composer.inputBuffer.depthTexture;

  if (!target || !stable || !shared || stable.source !== shared.source) return;

  const replacement = new THREE.DepthTexture(target.width, target.height);
  replacement.name = 'DataMosh.StableDepth';
  replacement.format = stable.format;
  replacement.type = stable.type;

  target.depthTexture = replacement;
  for (const pass of composer.passes) pass.setDepthTexture(replacement);
};
