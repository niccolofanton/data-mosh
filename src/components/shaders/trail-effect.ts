import { BlendFunction, Effect } from "postprocessing";
import * as THREE from "three";

/**
 * Opzioni per l'effetto Clone
 */
export interface TrailEffectOptions {
  trailAmount?: number;
  trailEnabled?: boolean;
  resolutionScale?: number;
  blendFunction?: BlendFunction;
}

// Shader comuni
const vertexShader = /*glsl*/ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
    }
`;

// Fragment shader per l'effetto di trail
const fragmentShader = /*glsl*/ `
    uniform sampler2D currentFrame;
    uniform sampler2D previousFrame;
    uniform float trailAmount;
    uniform bool trailEnabled;
    varying vec2 vUv;
    
    void main() {
        vec4 current = texture2D(currentFrame, vUv);
        
        if (trailEnabled) {
            vec4 previous = texture2D(previousFrame, vUv);
            gl_FragColor = vec4(mix(current.rgb, previous.rgb, trailAmount), 1.0);
        } else {
            gl_FragColor = current;
        }
    }
`;

// Shader GLSL principale per l'effetto
const mainImageShader = /*glsl*/ `
    uniform sampler2D previousFrame;
    uniform sampler2D currentFrame;
    uniform float trailAmount;
    uniform bool trailEnabled;

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec4 current = texture2D(currentFrame, uv);
        
        if (trailEnabled) {
            vec4 previous = texture2D(previousFrame, uv);
            outputColor = vec4(mix(current.rgb, previous.rgb, trailAmount), 1.0);
        } else {
            outputColor = current;
        }
    }
`;

const renderTargetOptions = {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  // format: THREE.RGBAFormat,
  stencilBuffer: false,
  depthBuffer: false,
  type: THREE.HalfFloatType,
};

/**
 * Effetto che crea un trail visivo mescolando i frame precedenti con quelli attuali
 */
export class TrailEffect extends Effect {
  private renderTargetA: THREE.WebGLRenderTarget;
  private renderTargetB: THREE.WebGLRenderTarget;
  private resolutionScale: number;
  private _localRenderer: THREE.WebGLRenderer | null = null;
  private _blendFunction: BlendFunction;

  // Scene e camera per il post-processing
  private postFXScene: THREE.Scene;
  private postFXMesh: THREE.Mesh;
  private orthoCamera: THREE.OrthographicCamera;

  constructor(options: TrailEffectOptions) {
    // Valori predefiniti per le opzioni
    const {
      trailAmount = 95,
      trailEnabled = true,
      resolutionScale = 0.5,
      blendFunction = BlendFunction.LIGHTEN,
    } = options;

    // Definisci gli uniform per lo shader
    const uniforms = new Map<string, THREE.Uniform<unknown>>([
      ["previousFrame", new THREE.Uniform(null)],
      ["currentFrame", new THREE.Uniform(null)],
      ["trailAmount", new THREE.Uniform(trailAmount / 100)],
      ["trailEnabled", new THREE.Uniform(trailEnabled)],
    ]);

    // Inizializza l'effetto base con lo shader GLSL
    super("TrailEffect", mainImageShader, {
      uniforms: uniforms,
      blendFunction: blendFunction,
    });

    this._blendFunction = blendFunction;
    this.resolutionScale = resolutionScale;

    // Crea la scena e la camera ortografica
    this.postFXScene = new THREE.Scene();
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Crea il materiale per l'effetto
    const postFXMaterial = new THREE.ShaderMaterial({
      uniforms: {
        currentFrame: { value: null },
        previousFrame: { value: null },
        trailAmount: { value: trailAmount / 100 },
        trailEnabled: { value: trailEnabled },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    // Crea il piano per il rendering dell'effetto
    this.postFXMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      postFXMaterial,
    );
    this.postFXScene.add(this.postFXMesh);

    // Crea i render target per il ping-pong
    this.renderTargetA = new THREE.WebGLRenderTarget(1, 1, renderTargetOptions);
    this.renderTargetB = new THREE.WebGLRenderTarget(1, 1, renderTargetOptions);
  }

  /**
   * Inizializza l'effetto con il renderer
   */
  initialize(
    renderer: THREE.WebGLRenderer,
    alpha: boolean,
    frameBufferType: number,
  ): void {
    super.initialize(renderer, alpha, frameBufferType);

    // Salva il riferimento al renderer
    this._localRenderer = renderer;

    // Imposta le dimensioni dei render target con la scala di risoluzione
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.setSize(size.width, size.height);

    // Pulisci i render target
    this.clearRenderTargets(renderer);
  }

  /**
   * Pulisce i render target
   */
  private clearRenderTargets(renderer: THREE.WebGLRenderer): void {
    const oldTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(this.renderTargetA);
    renderer.clear();

    renderer.setRenderTarget(this.renderTargetB);
    renderer.clear();

    renderer.setRenderTarget(oldTarget);
  }

  /**
   * Aggiorna l'effetto ad ogni frame
   */
  update(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
  ): void {
    // Renderizza l'effetto nel render target A
    renderer.setRenderTarget(this.renderTargetA);
    renderer.render(this.postFXScene, this.orthoCamera);
    this.swapRenderTargets();

    this.updateUniforms(inputBuffer);
  }

  /**
   * Aggiorna gli uniform con le texture correnti
   */
  private updateUniforms(inputBuffer: THREE.WebGLRenderTarget): void {
    const inputTexture = inputBuffer.texture;
    const previousTexture = this.renderTargetB.texture;

    // Aggiorna gli uniform per il materiale di post-processing
    if (this.postFXMesh.material instanceof THREE.ShaderMaterial) {
      this.postFXMesh.material.uniforms.currentFrame.value = inputTexture;
      this.postFXMesh.material.uniforms.previousFrame.value = previousTexture;
    }

    // Aggiorna gli uniform per l'effetto principale
    this.uniforms.get("currentFrame")!.value = inputTexture;
    this.uniforms.get("previousFrame")!.value = previousTexture;
  }

  /**
   * Scambia i render target per la tecnica ping-pong
   */
  private swapRenderTargets(): void {
    [this.renderTargetA, this.renderTargetB] = [
      this.renderTargetB,
      this.renderTargetA,
    ];
  }

  /**
   * Aggiorna le dimensioni dei render target
   */
  setSize(width: number, height: number): void {
    // Applica la scala di risoluzione
    const scaledWidth = Math.floor(width * this.resolutionScale);
    const scaledHeight = Math.floor(height * this.resolutionScale);

    this.renderTargetA.setSize(scaledWidth, scaledHeight);
    this.renderTargetB.setSize(scaledWidth, scaledHeight);
  }

  /**
   * Aggiorna le opzioni dell'effetto
   */
  updateOptions(
    trailAmount?: number,
    trailEnabled?: boolean,
    resolutionScale?: number,
    blendFunction?: BlendFunction,
  ): void {
    if (trailAmount !== undefined) {
      const normalizedValue = trailAmount / 100;
      this.uniforms.get("trailAmount")!.value = normalizedValue;

      if (this.postFXMesh.material instanceof THREE.ShaderMaterial) {
        this.postFXMesh.material.uniforms.trailAmount.value = normalizedValue;
      }
    }

    if (trailEnabled !== undefined) {
      this.uniforms.get("trailEnabled")!.value = trailEnabled;

      if (this.postFXMesh.material instanceof THREE.ShaderMaterial) {
        this.postFXMesh.material.uniforms.trailEnabled.value = trailEnabled;
      }
    }

    if (
      resolutionScale !== undefined &&
      resolutionScale !== this.resolutionScale
    ) {
      this.resolutionScale = resolutionScale;
      // Aggiorna le dimensioni dei render target se il renderer è disponibile
      if (this._localRenderer) {
        const size = this._localRenderer.getDrawingBufferSize(
          new THREE.Vector2(),
        );
        this.setSize(size.width, size.height);
      }
    }

    if (blendFunction !== undefined && blendFunction !== this._blendFunction) {
      this.updateBlendFunction(blendFunction);
    }
  }

  /**
   * Aggiorna la funzione di blending dell'effetto
   */
  updateBlendFunction(blendFunction: BlendFunction): void {
    this._blendFunction = blendFunction;
    this.blendMode.blendFunction = blendFunction;
    this.blendMode.setBlendFunction(blendFunction);
  }

  /**
   * Libera le risorse quando l'effetto viene distrutto
   */
  dispose(): void {
    super.dispose();

    this.renderTargetA.dispose();
    this.renderTargetB.dispose();

    if (this.postFXMesh) {
      this.postFXMesh.geometry.dispose();
      if (this.postFXMesh.material instanceof THREE.Material) {
        this.postFXMesh.material.dispose();
      }
    }

    this.postFXScene.clear();
  }
}
