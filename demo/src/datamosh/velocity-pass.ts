import { Pass } from 'postprocessing';
import * as THREE from 'three';
import { velocityFragmentShader, velocityVertexShader } from './shaders';

const PREVIOUS_MATRIX_KEY = '__dataMoshPreviousMatrixWorld';

/**
 * Call this on an object the moment it is teleported — a scroll that wraps, a
 * particle that respawns. The velocity pass has no way of telling a jump from
 * a movement, so it measures the whole distance as one frame of motion, and
 * the effect duly drags the picture that far: a visible tear, once per wrap.
 * Dropping the stored matrix makes the pass treat the object as new geometry
 * and write zero motion for that single frame instead.
 */
export const forgetPreviousMatrix = (object: THREE.Object3D): void => {
  delete object.userData[PREVIOUS_MATRIX_KEY];
};

/**
 * Renders the scene once more with a material that writes screen-space motion
 * instead of colour. Two things move a pixel: the camera, and the object's own
 * transform — so each mesh carries its previous world matrix in userData.
 */
export class VelocityPass extends Pass {
  readonly renderTarget: THREE.WebGLRenderTarget;

  private readonly velocityMaterial: THREE.ShaderMaterial;
  private readonly previousViewProjection = new THREE.Matrix4();
  private readonly scratchColor = new THREE.Color();
  private baseWidth = 1;
  private baseHeight = 1;
  private resolutionScale = 1;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    super('VelocityPass', scene, camera);
    this.needsSwap = false;

    // Half float: velocities are signed and small, and nearest filtering keeps
    // a block's vector from bleeding into its neighbour.
    this.renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
    });
    this.renderTarget.texture.name = 'DataMosh.Velocity';

    this.velocityMaterial = new THREE.ShaderMaterial({
      name: 'DataMosh.VelocityMaterial',
      vertexShader: velocityVertexShader,
      fragmentShader: velocityFragmentShader,
      uniforms: {
        uPreviousModelMatrix: { value: new THREE.Matrix4() },
        uPreviousViewProjection: { value: this.previousViewProjection },
        uHasPrevious: { value: 0 },
      },
    });

    // One material draws every mesh, so the per-object matrix has to be swapped
    // in here. uniformsNeedUpdate is load bearing: without it three uploads the
    // uniforms once and every mesh after the first gets the wrong matrix.
    this.velocityMaterial.onBeforeRender = (_r, _s, _c, _g, object) => {
      const uniforms = this.velocityMaterial.uniforms;
      const previous = object.userData[PREVIOUS_MATRIX_KEY] as THREE.Matrix4 | undefined;

      uniforms.uHasPrevious.value = previous ? 1 : 0;
      if (previous) (uniforms.uPreviousModelMatrix.value as THREE.Matrix4).copy(previous);

      const material = (object as THREE.Mesh).material;
      this.velocityMaterial.side = (Array.isArray(material) ? material[0] : material).side;
      this.velocityMaterial.uniformsNeedUpdate = true;
    };
  }

  render(renderer: THREE.WebGLRenderer): void {
    const scene = this.scene;
    const background = scene.background;
    const overrideMaterial = scene.overrideMaterial;
    const autoUpdateWorld = scene.matrixWorldAutoUpdate;
    const clearColor = renderer.getClearColor(this.scratchColor);
    const clearAlpha = renderer.getClearAlpha();

    // No background (it has no velocity), one material for everything, and no
    // matrix update: the render pass already did it this frame, and redoing it
    // now would overwrite what we are about to compare against.
    scene.background = null;
    scene.overrideMaterial = this.velocityMaterial;
    scene.matrixWorldAutoUpdate = false;

    // Clearing to alpha 0 is what marks "no geometry here" for the effect.
    renderer.setRenderTarget(this.renderTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, this.camera);

    renderer.setClearColor(clearColor, clearAlpha);
    scene.matrixWorldAutoUpdate = autoUpdateWorld;
    scene.overrideMaterial = overrideMaterial;
    scene.background = background;
  }

  /** End of frame: today's matrices become tomorrow's "previous". */
  capturePreviousState(): void {
    this.previousViewProjection.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );

    this.scene.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;

      const previous = object.userData[PREVIOUS_MATRIX_KEY] as THREE.Matrix4 | undefined;
      if (previous) previous.copy(object.matrixWorld);
      else object.userData[PREVIOUS_MATRIX_KEY] = object.matrixWorld.clone();
    });
  }

  // The composer sizes passes in drawing-buffer pixels; the scale slider then
  // shrinks the buffer on top of that, which is why both are kept.
  setResolutionScale(scale: number): void {
    this.resolutionScale = scale;
    this.setSize(this.baseWidth, this.baseHeight);
  }

  setSize(width: number, height: number): void {
    this.baseWidth = Math.max(1, width);
    this.baseHeight = Math.max(1, height);
    this.renderTarget.setSize(
      Math.max(1, Math.round(this.baseWidth * this.resolutionScale)),
      Math.max(1, Math.round(this.baseHeight * this.resolutionScale)),
    );
  }
}
