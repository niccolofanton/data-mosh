import * as THREE from "three";

/**
 * Small on screen previews of the intermediate frame buffers of the datamosh
 * pipeline (keyframe, feedback, depth, velocity).
 *
 * Reading a texture back to a 2D canvas means a synchronous GPU -> CPU
 * transfer, which is expensive, so the views share a single quad and each one
 * keeps its render target and pixel buffer alive across calls and refreshes at
 * a handful of frames per second instead of at render rate.
 */

const VIEW_WIDTH = 192;
const DEFAULT_INTERVAL = 1000 / 8;

export type DebugViewMode = "color" | "depth" | "velocity";

const MODE_INDEX: Record<DebugViewMode, number> = {
  color: 0,
  depth: 1,
  velocity: 2,
};

/**
 * Amplification of the motion vectors in the velocity preview. They are a few
 * thousandths of a uv unit, so the raw buffer reads as flat grey.
 */
const VELOCITY_PREVIEW_GAIN = 40;

const debugVertexShader = /*glsl*/ `
  varying vec2 vUv;
  void main() {
    // The pixel read back from the render target starts at the bottom row while
    // ImageData starts at the top one, so the source is sampled flipped.
    vUv = vec2(uv.x, 1.0 - uv.y);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const debugFragmentShader = /*glsl*/ `
  uniform sampler2D uTexture;
  uniform float uMode;          // 0 = colour, 1 = depth, 2 = velocity
  uniform float uNear;
  uniform float uFar;
  uniform float uVelocityGain;
  varying vec2 vUv;

  void main() {
    vec4 texel = texture2D(uTexture, vUv);

    if (uMode > 1.5) {
      // Red = motion to the right, green = motion up, black = no coverage.
      vec2 encoded = texel.rg * uVelocityGain * 0.5 + 0.5;
      gl_FragColor = vec4(clamp(vec3(encoded, 0.5), 0.0, 1.0) * texel.a, 1.0);
      return;
    }

    if (uMode > 0.5) {
      // Hyperbolic depth -> view z -> normalised distance.
      float viewZ = (uNear * uFar) / ((uFar - uNear) * texel.r - uFar);
      float linear = clamp((-viewZ - uNear) / (uFar - uNear), 0.0, 1.0);
      // Most of the scene sits in the first few percent of the range, so the
      // near end is expanded to make the preview readable.
      gl_FragColor = vec4(vec3(1.0 - pow(linear, 0.35)), 1.0);
      return;
    }

    gl_FragColor = vec4(texel.rgb, 1.0);
  }
`;

interface SharedResources {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  quad: THREE.Mesh;
  users: number;
}

let shared: SharedResources | null = null;

const acquireShared = (): SharedResources => {
  if (!shared) {
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    scene.add(quad);
    shared = { scene, camera, quad, users: 0 };
  }

  shared.users++;
  return shared;
};

const releaseShared = () => {
  if (!shared) return;

  shared.users--;
  if (shared.users > 0) return;

  shared.quad.geometry.dispose();
  (shared.quad.material as THREE.Material).dispose();
  shared = null;
};

/** One preview canvas, pinned to the left edge of the window. */
export class DebugFrameView {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly renderTarget: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly imageData: ImageData;
  private readonly pixels: Uint8Array;
  private readonly resources: SharedResources;
  private lastUpdate = 0;

  constructor(
    private readonly label: string,
    slot: number,
    aspect: number,
    private readonly mode: DebugViewMode = "color",
    private readonly interval: number = DEFAULT_INTERVAL,
  ) {
    const width = VIEW_WIDTH;
    const height = Math.max(1, Math.round(VIEW_WIDTH / Math.max(aspect, 0.1)));

    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.title = label;
    Object.assign(this.canvas.style, {
      position: "fixed",
      left: "10px",
      top: `${10 + slot * (height + 8)}px`,
      zIndex: "1000",
      pointerEvents: "none",
      border: "1px solid rgba(255,255,255,0.4)",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.canvas);

    this.context = this.canvas.getContext("2d");

    this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    // Keep the byte values in the same space as the source so the readback
    // does not need any conversion.
    this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;

    this.material = new THREE.ShaderMaterial({
      vertexShader: debugVertexShader,
      fragmentShader: debugFragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTexture: { value: null },
        uMode: { value: MODE_INDEX[mode] },
        uNear: { value: 0.1 },
        uFar: { value: 100 },
        uVelocityGain: { value: VELOCITY_PREVIEW_GAIN },
      },
    });

    // The readback writes straight into the ImageData backing store, so there
    // is no per frame allocation and no copy before putImageData.
    this.imageData = new ImageData(width, height);
    this.pixels = new Uint8Array(this.imageData.data.buffer);
    this.resources = acquireShared();
  }

  update(
    gl: THREE.WebGLRenderer,
    texture: THREE.Texture | null,
    now: number,
    camera?: THREE.PerspectiveCamera,
  ): void {
    if (!texture || !this.context) return;
    if (now - this.lastUpdate < this.interval) return;
    this.lastUpdate = now;

    if (this.mode === "depth" && camera) {
      this.material.uniforms.uNear.value = camera.near;
      this.material.uniforms.uFar.value = camera.far;
    }
    this.material.uniforms.uTexture.value = texture;

    const previousTarget = gl.getRenderTarget();
    const previousMaterial = this.resources.quad.material;

    this.resources.quad.material = this.material;
    gl.setRenderTarget(this.renderTarget);
    gl.render(this.resources.scene, this.resources.camera);
    gl.readRenderTargetPixels(
      this.renderTarget,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      this.pixels,
    );
    gl.setRenderTarget(previousTarget);
    this.resources.quad.material = previousMaterial;

    this.context.putImageData(this.imageData, 0, 0);

    this.context.font = "10px ui-monospace, monospace";
    this.context.fillStyle = "white";
    this.context.fillText(this.label, 5, 12);
  }

  dispose(): void {
    this.canvas.remove();
    this.renderTarget.dispose();
    this.material.dispose();
    releaseShared();
  }
}
