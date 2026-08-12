import { Pass } from "postprocessing";
import * as THREE from "three";
import { clothSampleGlsl } from "../cloth/cloth-glsl";
import {
  CLOTH_EXTENT_KEY,
  CLOTH_POSITIONS_KEY,
  CLOTH_PREVIOUS_KEY,
  CLOTH_SIZE,
} from "../cloth/cloth-sim";

/**
 * Screen space velocity buffer.
 *
 * A codec does not know anything about cameras: its motion vectors come from a
 * block matching search between two decoded pictures, so they capture *every*
 * movement, including objects that move while the camera stands still. This
 * pass is the closest cheap equivalent: the scene is drawn a second time with a
 * material that projects each vertex twice, once with the current
 * model/view/projection and once with the ones of the previous frame, and
 * writes the difference of the two screen positions.
 *
 * Output layout, RGBA:
 *   rg  screen space motion of that surface point, in uv units per frame,
 *       positive along the direction the content is travelling
 *   b   unused (kept at 0)
 *   a   coverage: 1 where geometry was rasterised, 0 on the cleared background
 *
 * The buffer therefore already contains the camera contribution: the effect
 * must use it *instead of* the analytic camera motion, never on top of it.
 *
 * Precision matters here. A typical vector is a handful of pixels, i.e. a few
 * thousandths of a uv unit, which an 8 bit per channel target cannot represent
 * (its smallest step is 1/255). The target is a half float one; support is
 * checked with `supportsVelocityBuffer` before the pass is ever enabled.
 */

/** userData key under which each mesh keeps its previous world matrix. */
const PREVIOUS_MATRIX_KEY = "__dataMoshPreviousMatrixWorld";

/**
 * userData key under which each skinned mesh keeps a copy of its bone texture
 * as it stood on the previous frame.
 */
const PREVIOUS_BONES_KEY = "__dataMoshPreviousBoneTexture";

/**
 * userData key under which each skinned mesh records the bone-texture version
 * its mirror was taken from, so an unchanged pose can be skipped.
 */
const PREVIOUS_BONES_VERSION_KEY = "__dataMoshPreviousBoneVersion";

/**
 * Safety clamp, in uv units per frame. A tab that was throttled or a geometry
 * swap can produce a nonsensical delta for a single frame; 0.25 (a quarter of
 * the screen in one frame) is far beyond anything the demo can legitimately
 * produce.
 */
const MAX_VELOCITY = 0.25;

const velocityVertexShader = /*glsl*/ `
  // Three decides USE_SKINNING from the object being drawn, not from the
  // material, so an override material gets the define whether it asked for it
  // or not - and a shader that ignores it rasterises every rigged character in
  // bind pose. The buffer would then hold a T-shaped patch of vectors sitting
  // nowhere near the dancer the viewer can see.
  //
  // Both poses are skinned: the current one through three's own chunks, the
  // previous one through a mirror of last frame's bone texture. Without the
  // second half a rigged figure contributes nothing at all to the motion field
  // unless the camera or its root moves - the mesh's own matrix never changes
  // while it dances - and a shot built around a dancer in front of a locked-off
  // camera would produce a completely empty buffer.
  // The cloth is the other case where the vertex on screen is not the vertex in
  // the buffer. Its shape lives entirely in a float texture the solver writes,
  // so this material has to read the same texture the render material does -
  // and, for the previous frame, the one the solver kept from the step before.
  // Without it the pass would rasterise the flat undisplaced plane and report a
  // motion field belonging to a shape nobody can see.
  uniform sampler2D uClothPositions;
  uniform sampler2D uClothPrevious;
  uniform vec2 uClothExtent;
  uniform float uClothSize;
  uniform float uHasCloth;

  ${clothSampleGlsl}

  #include <skinning_pars_vertex>

  #ifdef USE_SKINNING
    uniform highp sampler2D uPreviousBoneTexture;
    uniform float uHasPreviousBones;

    // Same layout three writes: four consecutive texels per bone, packed left
    // to right and wrapping by the texture's width.
    mat4 getPreviousBoneMatrix(const in float i) {
      int size = textureSize(uPreviousBoneTexture, 0).x;
      int j = int(i) * 4;
      int x = j % size;
      int y = j / size;

      return mat4(
        texelFetch(uPreviousBoneTexture, ivec2(x, y), 0),
        texelFetch(uPreviousBoneTexture, ivec2(x + 1, y), 0),
        texelFetch(uPreviousBoneTexture, ivec2(x + 2, y), 0),
        texelFetch(uPreviousBoneTexture, ivec2(x + 3, y), 0)
      );
    }
  #endif

  uniform mat4 uPreviousModelMatrix;
  uniform mat4 uPreviousViewProjection;
  uniform float uHasPrevious;

  varying vec4 vClipCurrent;
  varying vec4 vClipPrevious;

  void main() {
    vec3 transformed = position;

    #include <skinbase_vertex>
    #include <skinning_vertex>

    // Falls back to the current pose, which yields exactly zero limb velocity -
    // the right answer on the first frame, and for anything not skinned.
    vec3 previousPosition = transformed;

    #ifdef USE_SKINNING
      if (uHasPreviousBones > 0.5) {
        vec4 bindVertex = bindMatrix * vec4(position, 1.0);
        vec4 skinned = vec4(0.0);

        skinned += getPreviousBoneMatrix(skinIndex.x) * bindVertex * skinWeight.x;
        skinned += getPreviousBoneMatrix(skinIndex.y) * bindVertex * skinWeight.y;
        skinned += getPreviousBoneMatrix(skinIndex.z) * bindVertex * skinWeight.z;
        skinned += getPreviousBoneMatrix(skinIndex.w) * bindVertex * skinWeight.w;

        previousPosition = (bindMatrixInverse * skinned).xyz;
      }
    #endif

    if (uHasCloth > 0.5) {
      vec2 clothUv = clothTexel(position);
      transformed = clothPosition(uClothPositions, clothUv);
      previousPosition = clothPosition(uClothPrevious, clothUv);
    }

    vec4 clipCurrent = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
    vec4 clipPrevious = uPreviousViewProjection * uPreviousModelMatrix * vec4(previousPosition, 1.0);

    vClipCurrent = clipCurrent;
    // Without a registered previous matrix (first frame, object just added) the
    // previous position is the current one, which yields exactly zero velocity
    // instead of a delta against uninitialised data.
    vClipPrevious = mix(clipCurrent, clipPrevious, uHasPrevious);

    gl_Position = clipCurrent;
  }
`;

const velocityFragmentShader = /*glsl*/ `
  uniform float uMaxVelocity;

  varying vec4 vClipCurrent;
  varying vec4 vClipPrevious;

  void main() {
    // Perspective divide has to happen per fragment: interpolating the divided
    // value would be wrong for anything that is not parallel to the screen.
    vec2 ndcCurrent = vClipCurrent.xy / vClipCurrent.w;
    vec2 ndcPrevious = vClipPrevious.xy / vClipPrevious.w;

    // ndc spans [-1, 1] while uv spans [0, 1].
    vec2 velocity = (ndcCurrent - ndcPrevious) * 0.5;

    // A point that was behind the previous camera plane projects to garbage.
    if (vClipPrevious.w <= 0.0) {
      velocity = vec2(0.0);
    }

    gl_FragColor = vec4(clamp(velocity, -uMaxVelocity, uMaxVelocity), 0.0, 1.0);
  }
`;

/**
 * Whether the renderer can use a half float colour attachment, which the
 * velocity buffer needs to hold sub pixel motion.
 */
export const supportsVelocityBuffer = (
  renderer: THREE.WebGLRenderer,
): boolean =>
  renderer.capabilities.isWebGL2 &&
  (renderer.extensions.has("EXT_color_buffer_half_float") ||
    renderer.extensions.has("EXT_color_buffer_float"));

/**
 * A float RGBA texture laid out exactly like the one `Skeleton` builds: four
 * texels per bone matrix, nearest filtered and unmipmapped so `texelFetch` gets
 * the stored values back rather than an interpolation of them.
 */
const createBoneTexture = (width: number, height: number): THREE.DataTexture => {
  const texture = new THREE.DataTexture(
    new Float32Array(width * height * 4),
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.name = "DataMosh.PreviousBones";
  texture.needsUpdate = true;
  return texture;
};

export class VelocityPass extends Pass {
  readonly renderTarget: THREE.WebGLRenderTarget;

  private readonly velocityMaterial: THREE.ShaderMaterial;

  /** View projection matrix the camera had on the previous frame. */
  private readonly previousViewProjection = new THREE.Matrix4();
  private hasPreviousCamera = false;

  // Scratch object, reused to avoid a per frame allocation.
  private readonly scratchColor = new THREE.Color();

  /**
   * Bound to the previous-bones sampler for everything that has no history of
   * its own. The sampler is only declared in the skinned variant of the shader,
   * but a skinned mesh on its very first frame still has to point somewhere
   * valid while `uHasPreviousBones` says not to read it.
   */
  private readonly emptyBoneTexture = createBoneTexture(4, 4);

  private baseWidth = 1;
  private baseHeight = 1;
  private resolutionScale = 1;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    super("VelocityPass", scene, camera);

    // The pass writes to its own target and leaves the ping-pong buffers
    // untouched, so the composer must not swap them afterwards.
    this.needsSwap = false;

    this.renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      // Nearest on purpose: a motion vector is a piecewise constant field, and
      // interpolating it across a silhouette mixes two unrelated movements (and
      // would turn the coverage flag into a meaningless 0.5).
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.renderTarget.texture.name = "DataMosh.Velocity";
    this.renderTarget.texture.generateMipmaps = false;

    this.velocityMaterial = new THREE.ShaderMaterial({
      name: "DataMosh.VelocityMaterial",
      vertexShader: velocityVertexShader,
      fragmentShader: velocityFragmentShader,
      uniforms: {
        uPreviousModelMatrix: { value: new THREE.Matrix4() },
        uPreviousViewProjection: { value: new THREE.Matrix4() },
        uHasPrevious: { value: 0 },
        uPreviousBoneTexture: { value: this.emptyBoneTexture },
        uHasPreviousBones: { value: 0 },
        uClothPositions: { value: this.emptyBoneTexture },
        uClothPrevious: { value: this.emptyBoneTexture },
        uClothExtent: { value: new THREE.Vector2(1, 1) },
        uClothSize: { value: 1 },
        uHasCloth: { value: 0 },
        uMaxVelocity: { value: MAX_VELOCITY },
      },
    });

    // `scene.overrideMaterial` gives every mesh the same material instance, so
    // the per mesh previous matrix cannot live in a plain uniform. Three calls
    // `material.onBeforeRender` once per object, right before the uniforms are
    // uploaded, and hands over the object: that is the one hook that sees both
    // the shared material and the individual mesh. Mutating the objects'
    // `onBeforeRender` instead would mean touching scene graph nodes this pass
    // does not own, and iterating the meshes by hand would mean reimplementing
    // frustum culling and render ordering.
    this.velocityMaterial.onBeforeRender = (
      _renderer,
      _scene,
      _camera,
      _geometry,
      object,
    ) => {
      const uniforms = this.velocityMaterial.uniforms;
      const previous = object.userData[PREVIOUS_MATRIX_KEY] as
        | THREE.Matrix4
        | undefined;

      if (previous !== undefined && this.hasPreviousCamera) {
        (uniforms.uPreviousModelMatrix.value as THREE.Matrix4).copy(previous);
        uniforms.uHasPrevious.value = 1;
      } else {
        uniforms.uHasPrevious.value = 0;
      }

      // Per object, like the matrix above and for the same reason: one shared
      // material, so the pose history cannot live in a plain uniform.
      const bones = object.userData[PREVIOUS_BONES_KEY] as
        | THREE.DataTexture
        | undefined;

      const hasBones = bones !== undefined && this.hasPreviousCamera;
      uniforms.uPreviousBoneTexture.value = hasBones
        ? bones
        : this.emptyBoneTexture;
      uniforms.uHasPreviousBones.value = hasBones ? 1 : 0;

      // Same story again for a GPU-simulated sheet: one shared material, so the
      // per object state has to be pushed here.
      const clothNow = object.userData[CLOTH_POSITIONS_KEY] as
        | THREE.Texture
        | undefined;
      const clothBefore = object.userData[CLOTH_PREVIOUS_KEY] as
        | THREE.Texture
        | undefined;
      const extent = object.userData[CLOTH_EXTENT_KEY] as
        | [number, number]
        | undefined;

      const hasCloth =
        clothNow !== undefined &&
        clothBefore !== undefined &&
        extent !== undefined;

      if (hasCloth) {
        uniforms.uClothPositions.value = clothNow;
        uniforms.uClothPrevious.value = clothBefore;
        (uniforms.uClothExtent.value as THREE.Vector2).set(
          extent[0],
          extent[1],
        );
        uniforms.uClothSize.value = CLOTH_SIZE;
      }
      uniforms.uHasCloth.value = hasCloth ? 1 : 0;

      // Match the culling of the real material: the room is seen from the
      // inside, so its walls would be missing from the buffer if the override
      // material always used the default front side. Three reads `side` again
      // for every object, so this is a plain state change, not a recompile.
      const source = (object as THREE.Mesh).material;
      const first = Array.isArray(source) ? source[0] : source;
      if (first !== undefined) {
        this.velocityMaterial.side = first.side;
      }

      // Three only uploads a ShaderMaterial's uniforms once per frame unless it
      // is told otherwise; without this flag every mesh would be drawn with the
      // first mesh's previous matrix.
      this.velocityMaterial.uniformsNeedUpdate = true;
    };
  }

  render(renderer: THREE.WebGLRenderer): void {
    const scene = this.scene;
    const camera = this.camera;

    const background = scene.background;
    const overrideMaterial = scene.overrideMaterial;
    const shadowMapAutoUpdate = renderer.shadowMap.autoUpdate;
    // Kept as a Color rather than a hex so restoring it cannot quantise it.
    const clearColor = renderer.getClearColor(this.scratchColor);
    const clearAlpha = renderer.getClearAlpha();

    // The background is drawn by the renderer itself and would bypass the
    // override material, filling the buffer with the clear colour read as a
    // motion vector.
    scene.background = null;
    scene.overrideMaterial = this.velocityMaterial;
    renderer.shadowMap.autoUpdate = false;

    (
      this.velocityMaterial.uniforms.uPreviousViewProjection
        .value as THREE.Matrix4
    ).copy(this.previousViewProjection);

    // This is the second time the same graph is drawn this frame, and
    // `renderer.render` would re-run `scene.updateMatrixWorld()` to derive
    // world matrices that are already correct. That walk recurses into every
    // child whether or not it is visible, and this scene is ~955 nodes, 903 of
    // them bones belonging to shots that are off screen. Nothing between the
    // RenderPass and here touches the graph - only full-screen effect passes,
    // each on a scene of its own - so the values it would recompute are the
    // ones already there.
    //
    // Three also de-duplicates `skeleton.update()` and the bone texture upload
    // per `info.render.frame`, and a second `render()` defeats it: all 14
    // skeletons recompute and re-upload, ~90 KB a frame. Rewinding that counter
    // to make the dedupe hit was tried and does not work - `projectObject`
    // reads the counter *before* `render()` increments it, and every effect
    // pass in between is itself a `renderer.render` that bumps it, so the
    // offset depends on how many passes happen to be enabled. Measured: no
    // change to frame time, so it is not worth reaching further into three.
    const autoUpdateWorld = scene.matrixWorldAutoUpdate;
    scene.matrixWorldAutoUpdate = false;

    renderer.setRenderTarget(this.renderTarget);
    // Coverage is carried by alpha, so the background has to be cleared to a
    // fully transparent black rather than to the scene's clear colour.
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);

    scene.matrixWorldAutoUpdate = autoUpdateWorld;

    renderer.setClearColor(clearColor, clearAlpha);
    renderer.shadowMap.autoUpdate = shadowMapAutoUpdate;
    scene.overrideMaterial = overrideMaterial;
    scene.background = background;
  }

  /**
   * Records the transforms of this frame so the next one can measure against
   * them.
   *
   * This must run on *every* frame, including the ones where the pass itself is
   * disabled: otherwise the first frame of a mosh gesture would compare against
   * a matrix from an arbitrarily long time ago and produce one huge, wrong
   * vector. It has to run after the scene has been rendered, because that is
   * when the world matrices are up to date.
   */
  capturePreviousState(): void {
    const camera = this.camera;

    // Safe to overwrite in place: the pass copies it into the uniform at the
    // start of its own render, which has already happened by now.
    this.previousViewProjection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.hasPreviousCamera = true;

    this.scene.traverse(this.captureObject);
  }

  /**
   * Hoisted rather than written inline at the `traverse` call: a fresh closure
   * per frame is 60 short-lived allocations a second for a function that closes
   * over nothing but `this`.
   */
  private readonly captureObject = (object: THREE.Object3D): void => {
    if (!(object as THREE.Mesh).isMesh) return;

    const previous = object.userData[PREVIOUS_MATRIX_KEY] as
      | THREE.Matrix4
      | undefined;

    if (previous === undefined) {
      object.userData[PREVIOUS_MATRIX_KEY] = object.matrixWorld.clone();
    } else {
      previous.copy(object.matrixWorld);
    }

    this.captureBones(object as THREE.SkinnedMesh);
  };

  /**
   * Mirrors a skinned mesh's bone texture so the next frame can skin against
   * the pose this one was drawn in.
   *
   * The skeleton's own texture cannot simply be held onto: three overwrites it
   * in place every time the mixer advances, so by the time the next frame reads
   * it, it would be describing that frame rather than this one. The copy is
   * cheap - a rig this size is a 16x16 texture - and it is the only thing that
   * lets the pass see a limb move.
   */
  private captureBones(mesh: THREE.SkinnedMesh): void {
    if (!mesh.isSkinnedMesh) return;

    const skeleton = mesh.skeleton;
    // Null until the renderer has drawn the mesh once and built it.
    const source = skeleton?.boneTexture;
    if (skeleton === undefined || source === null || source === undefined) {
      return;
    }

    const width = source.image.width as number;
    const height = source.image.height as number;

    let mirror = mesh.userData[PREVIOUS_BONES_KEY] as
      | THREE.DataTexture
      | undefined;

    if (
      mirror === undefined ||
      mirror.image.width !== width ||
      mirror.image.height !== height
    ) {
      mirror?.dispose();
      mirror = createBoneTexture(width, height);
      mesh.userData[PREVIOUS_BONES_KEY] = mirror;
    }

    // `Skeleton.update()` bumps the source texture's version, and it only runs
    // for a mesh the renderer actually drew. An unchanged version therefore
    // means the pose already mirrored *is* this frame's pose, and the copy
    // would write back the bytes it wrote last time. That is every frame for
    // the two shots that are off screen - the mixers below them are gated on
    // visibility, so their matrices genuinely cannot move - and it is 72 KB of
    // memcpy plus 14 texture re-uploads each time.
    const version = source.version;
    if (mesh.userData[PREVIOUS_BONES_VERSION_KEY] === version) return;
    mesh.userData[PREVIOUS_BONES_VERSION_KEY] = version;

    (mirror.image.data as Float32Array).set(skeleton.boneMatrices);
    mirror.needsUpdate = true;
  }

  /** Renders the buffer at a fraction of the display resolution. */
  setResolutionScale(scale: number): void {
    this.resolutionScale = THREE.MathUtils.clamp(scale, 0.1, 1);
    this.applyResolution();
  }

  setSize(width: number, height: number): void {
    this.baseWidth = Math.max(1, width);
    this.baseHeight = Math.max(1, height);
    this.applyResolution();
  }

  dispose(): void {
    // The matrices and textures are stored on scene objects this pass does not
    // own, so they have to be handed back rather than left behind.
    this.scene.traverse((object) => {
      const bones = object.userData[PREVIOUS_BONES_KEY] as
        | THREE.DataTexture
        | undefined;
      bones?.dispose();

      delete object.userData[PREVIOUS_MATRIX_KEY];
      delete object.userData[PREVIOUS_BONES_KEY];
      delete object.userData[PREVIOUS_BONES_VERSION_KEY];
    });
    this.emptyBoneTexture.dispose();
    super.dispose();
  }

  private applyResolution(): void {
    this.renderTarget.setSize(
      Math.max(1, Math.round(this.baseWidth * this.resolutionScale)),
      Math.max(1, Math.round(this.baseHeight * this.resolutionScale)),
    );
  }
}
