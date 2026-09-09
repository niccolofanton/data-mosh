import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';
import { controls } from '../debug';
import { mainImageShader } from './shaders';

/**
 * Effect wants its uniforms declared in JS as well as in the shader. Reading
 * them straight off the source keeps the two from drifting apart: add a uniform
 * to the GLSL and it exists here, with a value of the right shape.
 */
const uniformsOf = (shader: string) =>
  new Map<string, THREE.Uniform>(
    [...shader.matchAll(/uniform\s+(\w+)\s+(\w+);/g)].map(([, type, name]) => [
      name,
      new THREE.Uniform(
        type === 'mat4' ? new THREE.Matrix4()
        : type === 'vec2' ? new THREE.Vector2(1, 1)
        : type === 'sampler2D' ? null
        : 0,
      ),
    ]),
  );

export class DataMoshEffect extends Effect {
  private readonly previousMatrixWorld = new THREE.Matrix4();
  private readonly previousProjection = new THREE.Matrix4();
  private readonly scratchMatrix = new THREE.Matrix4();
  private hasPreviousCamera = false;

  constructor(private readonly camera: THREE.Camera) {
    // SRC replaces the pixel instead of blending over it (the shader does its
    // own mixing), and DEPTH asks the composer for the depth texture the
    // camera-motion fallback unprojects through.
    super('DataMosh', mainImageShader, {
      uniforms: uniformsOf(mainImageShader),
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.DEPTH,
    });
  }

  set(name: string, value: number | THREE.Texture): void {
    this.uniforms.get(name)!.value = value;
  }

  /**
   * The history and velocity textures can be smaller than the frame the pass
   * decodes. The Catmull-Rom taps and the residual's low-pass reads position
   * themselves in texels of *those* textures, so they need the real size, not
   * the pass resolution.
   */
  setHistoryResolution(width: number, height: number): void {
    (this.uniforms.get('uHistoryResolution')!.value as THREE.Vector2).set(width, height);
  }

  capturePreviousState(): void {
    this.previousMatrixWorld.copy(this.camera.matrixWorld);
    this.previousProjection.copy(this.camera.projectionMatrix);
    this.hasPreviousCamera = true;
  }

  /**
   * Called by the composer every frame: hands the shader the matrices it needs
   * to walk a pixel from this frame back to the previous one. The rotation-only
   * variant is the same view with the camera left where it is now, which is
   * what the parallax slider mixes towards.
   */
  update(): void {
    this.set('uTime', performance.now());

    const camera = this.camera;
    const matrix = (name: string) => this.uniforms.get(name)!.value as THREE.Matrix4;

    matrix('uInvViewProjection')
      .copy(camera.matrixWorld)
      .multiply(camera.projectionMatrixInverse);

    const matrixWorld = this.hasPreviousCamera ? this.previousMatrixWorld : camera.matrixWorld;
    const projection = this.hasPreviousCamera ? this.previousProjection : camera.projectionMatrix;

    matrix('uPrevViewProjection').multiplyMatrices(
      projection,
      this.scratchMatrix.copy(matrixWorld).invert(),
    );

    this.scratchMatrix.copy(matrixWorld).copyPosition(camera.matrixWorld);
    matrix('uPrevViewProjectionRot').multiplyMatrices(projection, this.scratchMatrix.invert());
  }

  /**
   * Panel to shader by naming convention: `uBlockSize` takes `controls.blockSize`.
   * Only the four that are not a plain number copy need spelling out.
   */
  applySettings(): void {
    for (const [name, uniform] of this.uniforms) {
      const value = (controls as Record<string, unknown>)[
        name[1].toLowerCase() + name.slice(2)
      ];
      if (typeof value === 'number') uniform.value = value;
    }

    this.set('uBlockiness', controls.macroblocks ? controls.blockiness : 0);
    this.set('uResidualGain', controls.residualGain / 10);
    this.set('uDebugMotion', controls.debugMotion ? 1 : 0);
    this.set('uShowLostSectors', controls.showLostSectors ? 1 : 0);
    this.set('uShowMotionArrows', controls.showMotionArrows ? 1 : 0);
    this.set('uDebugField', controls.debugView === 'arrows' ? 0 : 1);
    this.set('uDebugArrows', controls.debugView === 'field' ? 0 : 1);
  }
}
