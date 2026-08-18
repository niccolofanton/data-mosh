import * as THREE from "three";

/**
 * Cloth solved on the GPU: Verlet integration with Jacobi distance constraints,
 * run entirely in float render targets.
 *
 * The particle grid lives in a square texture, one texel per particle: xyz is
 * the world position, w is the pin flag. Nothing is ever read back to the CPU -
 * the rendered mesh samples the same texture in its vertex shader, so the
 * simulated positions never cross the bus.
 *
 * Why Jacobi and not Gauss-Seidel. A CPU solver relaxes constraints in place,
 * one after another, so each one sees the corrections the previous ones just
 * made and the whole set converges fast. A fragment shader cannot do that: every
 * texel is computed from the same input image, in unspecified order, with no way
 * to observe a neighbour's new value. So each particle instead *gathers* the
 * error of all twelve constraints it belongs to and applies their average. That
 * converges more slowly per iteration, which is paid for with more iterations,
 * and it is unconditionally stable in a way the sequential version is not.
 *
 * Three targets, rotated rather than two. Verlet needs the position at n and at
 * n-1 to derive velocity, and the constraint passes need somewhere to ping-pong
 * that is not either of those. The rotation is: integrate reads current and
 * previous and writes the third; that frees the previous buffer, which the
 * relaxation passes then ping-pong against; what was current becomes the new
 * previous.
 */

/** Particles per side. The grid is square; the cloth need not be. */
export const CLOTH_SIZE = 64;

/**
 * userData keys through which a cloth mesh publishes its state.
 *
 * They live here, in the module with no React and no scene-graph dependencies,
 * because the velocity pass reads them and must not have to import a component
 * to do it.
 */
export const CLOTH_POSITIONS_KEY = "__dataMoshClothPositions";
export const CLOTH_PREVIOUS_KEY = "__dataMoshClothPrevious";
export const CLOTH_EXTENT_KEY = "__dataMoshClothExtent";

/** Fixed timestep. A simulation that follows the frame rate changes stiffness
 *  with it, and a dropped frame becomes an explosion. */
const DT = 1 / 60;

const quadVertexShader = /*glsl*/ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const integrateShader = /*glsl*/ `
  precision highp float;

  uniform sampler2D uCurrent;
  uniform sampler2D uPrevious;
  uniform vec2 uTexel;
  uniform float uDamping;
  uniform vec3 uGravity;
  uniform vec3 uWind;
  uniform float uTime;
  uniform vec3 uPointer;
  uniform float uPointerRadius;
  uniform float uPointerActive;
  uniform float uStep2;
  uniform float uTurbulence;
  uniform float uTurbulenceScale;

  varying vec2 vUv;

  /**
   * Three octaves of sine noise over position and time.
   *
   * A single global wind vector, however it is animated, moves every particle
   * the same way at the same instant: the sheet swells and subsides as one
   * piece, which reads as breathing rather than as air. Real turbulence is
   * *spatial* - the field differs from one part of the cloth to the next - and
   * that is what makes ripples travel across a surface instead of pulsing on
   * the spot.
   *
   * Sines rather than a hash: the field has to be continuous in space, or
   * neighbouring particles get uncorrelated forces and the constraint solver
   * spends every iteration undoing the noise instead of holding the shape.
   */
  float turbulence(vec3 p) {
    return sin(p.x * 3.1 + p.z * 1.7) * sin(p.y * 2.3 - p.z * 1.1)
         + 0.5 * sin(p.x * 6.7 - p.z * 2.9) * sin(p.y * 5.3 + p.z * 2.1)
         + 0.25 * sin(p.x * 13.1 + p.z * 4.3) * sin(p.y * 11.7 - p.z * 3.7);
  }

  void main() {
    vec4 state = texture2D(uCurrent, vUv);
    vec3 p = state.xyz;

    // Pinned particles are the boundary condition, not participants: they are
    // written straight back, which also stops the constraint passes from ever
    // moving them.
    if (state.w > 0.5) {
      gl_FragColor = state;
      return;
    }

    vec3 q = texture2D(uPrevious, vUv).xyz;

    // Surface normal from the four neighbours. The wind is pushed along it
    // rather than in a straight line, which is the difference between a sheet
    // that billows and one that is merely blown sideways: a face edge-on to the
    // wind catches nothing, and that is what creates folds.
    vec3 left  = texture2D(uCurrent, vUv - vec2(uTexel.x, 0.0)).xyz;
    vec3 right = texture2D(uCurrent, vUv + vec2(uTexel.x, 0.0)).xyz;
    vec3 down  = texture2D(uCurrent, vUv - vec2(0.0, uTexel.y)).xyz;
    vec3 up    = texture2D(uCurrent, vUv + vec2(0.0, uTexel.y)).xyz;

    vec3 across = right - left;
    vec3 along = up - down;
    vec3 n = cross(across, along);
    n = length(n) > 1e-8 ? normalize(n) : vec3(0.0, 0.0, 1.0);

    // The turbulent field: a different vector at every point of the sheet, and
    // a different one again a moment later. Sampled at three decorrelated
    // offsets so the three components do not march together, which they would
    // if they shared a seed and the whole thing would collapse back into one
    // direction.
    vec3 s = vec3(p.xy * uTurbulenceScale, uTime);
    vec3 swirl = vec3(
      turbulence(s),
      turbulence(s.yxz + vec3(11.3, 4.1, 0.7)),
      turbulence(s.xyz * 0.8 + vec3(27.7, 19.1, 1.3))
    );

    float speed = length(uWind);
    vec3 wind = uWind + swirl * (uTurbulence * speed);

    // Spatial term on the gust so neighbouring folds are never in phase.
    float flutter = 0.78 + 0.22 * sin(uTime * 2.3 + p.x * 2.9 + p.y * 2.1);

    // The turbulence gets a direct term as well as a projected one. Projecting
    // everything onto the normal is right for a steady wind - a face edge-on to
    // it catches nothing - but it also means the sheet can only ever be pushed
    // the way it is already facing, and it never gets dragged sideways or
    // snapped along its own plane, which is most of what a gust actually does.
    vec3 force = uGravity
               + n * dot(n, wind) * flutter
               + swirl * (uTurbulence * speed * 0.3);

    vec3 next = p + (p - q) * uDamping + force * uStep2;

    // The pointer is a solid sphere: anything inside it is pushed to its
    // surface. Projecting rather than adding a force means the cloth cannot be
    // driven through it however fast the cursor moves.
    if (uPointerActive > 0.5) {
      vec3 delta = next - uPointer;
      float dist = length(delta);
      if (dist < uPointerRadius) {
        vec3 dir = dist > 1e-5 ? delta / dist : vec3(0.0, 0.0, 1.0);
        next = uPointer + dir * uPointerRadius;
      }
    }

    gl_FragColor = vec4(next, state.w);
  }
`;

const relaxShader = /*glsl*/ `
  precision highp float;

  uniform sampler2D uPositions;
  uniform vec2 uTexel;
  uniform vec2 uSpacing;    // rest length of a structural link, in x and y
  uniform float uStiffness;
  uniform float uBend;

  varying vec2 vUv;

  /**
   * Half of the error of one distance constraint, or zero if the neighbour is
   * off the edge of the grid.
   *
   * Half, because the constraint is symmetric: the neighbour's own shader
   * invocation is applying the other half in the opposite direction. Taking the
   * whole error at both ends would overshoot and oscillate.
   */
  vec3 pull(vec2 uv, vec2 offset, float rest, vec3 p, inout float count) {
    vec2 n = uv + offset;
    if (n.x < 0.0 || n.x > 1.0 || n.y < 0.0 || n.y > 1.0) return vec3(0.0);

    vec3 other = texture2D(uPositions, n).xyz;
    vec3 d = other - p;
    float len = max(length(d), 1e-5);

    count += 1.0;
    return d * ((len - rest) / len) * 0.5;
  }

  void main() {
    vec4 state = texture2D(uPositions, vUv);
    if (state.w > 0.5) {
      gl_FragColor = state;
      return;
    }

    vec3 p = state.xyz;
    vec2 t = uTexel;
    float sx = uSpacing.x;
    float sy = uSpacing.y;
    float diag = length(uSpacing);

    // Structural: the four links along the weave. Shear: the four diagonals,
    // which are what stop the grid from collapsing into a parallelogram.
    float structuralCount = 0.0;
    vec3 structural = vec3(0.0);
    structural += pull(vUv, vec2(-t.x, 0.0), sx, p, structuralCount);
    structural += pull(vUv, vec2( t.x, 0.0), sx, p, structuralCount);
    structural += pull(vUv, vec2(0.0, -t.y), sy, p, structuralCount);
    structural += pull(vUv, vec2(0.0,  t.y), sy, p, structuralCount);
    structural += pull(vUv, vec2(-t.x, -t.y), diag, p, structuralCount);
    structural += pull(vUv, vec2( t.x, -t.y), diag, p, structuralCount);
    structural += pull(vUv, vec2(-t.x,  t.y), diag, p, structuralCount);
    structural += pull(vUv, vec2( t.x,  t.y), diag, p, structuralCount);

    // Bend: links that skip a particle. They resist folding rather than
    // stretching, so they are deliberately soft - stiff bend constraints give
    // sheet metal, not cloth.
    float bendCount = 0.0;
    vec3 bend = vec3(0.0);
    bend += pull(vUv, vec2(-2.0 * t.x, 0.0), sx * 2.0, p, bendCount);
    bend += pull(vUv, vec2( 2.0 * t.x, 0.0), sx * 2.0, p, bendCount);
    bend += pull(vUv, vec2(0.0, -2.0 * t.y), sy * 2.0, p, bendCount);
    bend += pull(vUv, vec2(0.0,  2.0 * t.y), sy * 2.0, p, bendCount);

    // Averaged, not summed: with a gather formulation the corrections all come
    // from the same input, so adding them applies the same displacement a dozen
    // times over and the sheet tears itself apart on the first frame.
    if (structuralCount > 0.0) p += structural / structuralCount * uStiffness;
    if (bendCount > 0.0) p += bend / bendCount * uBend;

    gl_FragColor = vec4(p, state.w);
  }
`;

export interface ClothParams {
  gravity: number;
  wind: number;
  gustiness: number;
  stiffness: number;
  bend: number;
  damping: number;
  iterations: number;
  /** How much of the wind is spatially varying rather than uniform. */
  turbulence: number;
  /** Size of the eddies, in inverse world units: larger is finer. */
  turbulenceScale: number;
}

/**
 * Whether the renderer can hold particle positions at all.
 *
 * Half float is not an option here even though it is for the velocity buffer:
 * Verlet derives velocity from the difference of two positions, and at half
 * float that difference is quantised to about a millimetre at these scales -
 * the same order as the movement being measured, so the cloth either freezes or
 * jitters.
 */
export const supportsClothSimulation = (
  renderer: THREE.WebGLRenderer,
): boolean =>
  renderer.capabilities.isWebGL2 &&
  renderer.extensions.has("EXT_color_buffer_float");

export class ClothSimulation {
  readonly width: number;
  readonly height: number;

  /** What the mesh and the velocity pass sample. */
  get positions(): THREE.Texture {
    return this.targets[this.current].texture;
  }

  /** The same, one frame ago, for the motion vectors. */
  get previousPositions(): THREE.Texture {
    return this.targets[this.previous].texture;
  }

  private readonly targets: THREE.WebGLRenderTarget[];
  private current = 0;
  private previous = 1;
  private spare = 2;

  private readonly quad: THREE.Mesh;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly scene = new THREE.Scene();
  private readonly integrate: THREE.ShaderMaterial;
  private readonly relax: THREE.ShaderMaterial;

  private time = 0;

  constructor(width: number, height: number, private readonly size = CLOTH_SIZE) {
    this.width = width;
    this.height = height;

    this.targets = [0, 1, 2].map((i) => {
      const target = new THREE.WebGLRenderTarget(size, size, {
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
        // Nearest, always: a position texture is point data, and interpolating
        // between two particles would invent a third that no constraint knows
        // about.
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
      });
      target.texture.name = `Cloth.Positions${i}`;
      target.texture.generateMipmaps = false;
      return target;
    });

    const texel = new THREE.Vector2(1 / size, 1 / size);

    this.integrate = new THREE.ShaderMaterial({
      name: "Cloth.Integrate",
      vertexShader: quadVertexShader,
      fragmentShader: integrateShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uCurrent: { value: null },
        uPrevious: { value: null },
        uTexel: { value: texel },
        uDamping: { value: 0.985 },
        uGravity: { value: new THREE.Vector3(0, -6, 0) },
        uWind: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uPointer: { value: new THREE.Vector3() },
        uPointerRadius: { value: 0.35 },
        uPointerActive: { value: 0 },
        uStep2: { value: DT * DT },
        uTurbulence: { value: 1 },
        uTurbulenceScale: { value: 1 },
      },
    });

    this.relax = new THREE.ShaderMaterial({
      name: "Cloth.Relax",
      vertexShader: quadVertexShader,
      fragmentShader: relaxShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPositions: { value: null },
        uTexel: { value: texel },
        uSpacing: {
          value: new THREE.Vector2(width / (size - 1), height / (size - 1)),
        },
        uStiffness: { value: 1.4 },
        uBend: { value: 0.35 },
      },
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.integrate);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /**
   * Fills every target with the rest pose.
   *
   * The whole top row is pinned. Two corner clips drape more prettily, but with
   * a gather solver they also stretch: a Jacobi pass propagates a correction by
   * one particle per iteration, so a pull at the corners takes as many
   * iterations as the grid is wide to reach the far edge, and at eight per
   * frame it never gets there. Pinning the edge removes the long chain instead
   * of fighting it.
   */
  reset(renderer: THREE.WebGLRenderer): void {
    const { size } = this;
    const data = new Float32Array(size * size * 4);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const u = x / (size - 1);
        const v = y / (size - 1);

        data[i] = (u - 0.5) * this.width;
        data[i + 1] = (v - 0.5) * this.height;
        // A hair of noise in z, because a perfectly flat sheet has no reason to
        // fold one way rather than the other and will hang dead straight.
        data[i + 2] = Math.sin(x * 1.7) * Math.cos(y * 0.63) * 0.004;
        data[i + 3] = y === size - 1 ? 1 : 0;
      }
    }

    const seed = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    seed.minFilter = THREE.NearestFilter;
    seed.magFilter = THREE.NearestFilter;
    seed.needsUpdate = true;

    const blit = new THREE.ShaderMaterial({
      vertexShader: quadVertexShader,
      fragmentShader: /*glsl*/ `
        precision highp float;
        uniform sampler2D uSeed;
        varying vec2 vUv;
        void main() { gl_FragColor = texture2D(uSeed, vUv); }
      `,
      uniforms: { uSeed: { value: seed } },
      depthTest: false,
      depthWrite: false,
    });

    const previousTarget = renderer.getRenderTarget();
    this.quad.material = blit;
    for (const target of this.targets) {
      renderer.setRenderTarget(target);
      renderer.render(this.scene, this.camera);
    }
    renderer.setRenderTarget(previousTarget);

    blit.dispose();
    seed.dispose();
  }

  /** Advances one fixed step. */
  step(
    renderer: THREE.WebGLRenderer,
    delta: number,
    params: ClothParams,
    pointer: THREE.Vector3 | null,
  ): void {
    this.time += delta;

    const iu = this.integrate.uniforms;
    iu.uDamping.value = params.damping;
    (iu.uGravity.value as THREE.Vector3).set(0, -params.gravity, 0);
    iu.uTime.value = this.time;
    iu.uTurbulence.value = params.turbulence;
    iu.uTurbulenceScale.value = params.turbulenceScale;

    // Sum of sines with a squared gust envelope: the square is what keeps the
    // lulls long and the gusts short, which is what wind actually does. A plain
    // sine gives a sheet that breathes in and out like a lung.
    const t = this.time;
    const gust =
      params.gustiness *
      Math.max(0, Math.sin(t * 0.43) * 0.6 + Math.sin(t * 0.9 + 2.1) * 0.4) ** 2;
    const magnitude =
      (0.16 + params.wind * (0.5 + 0.5 * Math.sin(t * 0.8) * Math.sin(t * 0.37 + 1.3)) +
        gust * 0.85) * 5;

    (iu.uWind.value as THREE.Vector3)
      .set(0.45 * Math.sin(t * 0.5) + 0.22, 0.1 * Math.sin(t * 0.77), 1)
      .normalize()
      .multiplyScalar(magnitude);

    if (pointer === null) {
      iu.uPointerActive.value = 0;
    } else {
      iu.uPointerActive.value = 1;
      (iu.uPointer.value as THREE.Vector3).copy(pointer);
    }

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    // Integrate into the spare buffer, which frees the one holding n-1.
    iu.uCurrent.value = this.targets[this.current].texture;
    iu.uPrevious.value = this.targets[this.previous].texture;
    this.quad.material = this.integrate;
    renderer.setRenderTarget(this.targets[this.spare]);
    renderer.render(this.scene, this.camera);

    // Relaxation ping-pongs between the freshly integrated buffer and the one
    // that just became free.
    let read = this.spare;
    let write = this.previous;

    this.quad.material = this.relax;
    this.relax.uniforms.uStiffness.value = params.stiffness;
    this.relax.uniforms.uBend.value = params.bend;

    for (let i = 0; i < params.iterations; i++) {
      this.relax.uniforms.uPositions.value = this.targets[read].texture;
      renderer.setRenderTarget(this.targets[write]);
      renderer.render(this.scene, this.camera);

      const swap = read;
      read = write;
      write = swap;
    }

    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;

    // `read` now holds the solved positions; what was current becomes n-1.
    this.spare = write;
    this.previous = this.current;
    this.current = read;
  }

  dispose(): void {
    for (const target of this.targets) target.dispose();
    this.quad.geometry.dispose();
    this.integrate.dispose();
    this.relax.dispose();
  }
}
