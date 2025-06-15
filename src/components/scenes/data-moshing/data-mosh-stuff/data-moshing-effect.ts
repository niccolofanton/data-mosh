import { BlendFunction, Effect } from "postprocessing";
import * as THREE from "three";
import { mainImageShader } from "./shaders/data-moshing-shaders";

/**
 * Opzioni per l'effetto DataMosh
 */
export interface DataMoshOptions {
  fadeDuration?: number;
  effectEnabled?: boolean;
  resolutionScale?: number;
  blendFunction?: BlendFunction;
  camera: THREE.Camera;
  buttonPressed?: boolean;
  lastButtonReleaseTime?: number;
  debugMode?: boolean;
  corruptionChunkCount?: number;
  corruptionStrength?: number;
  corruptionSpeed?: number;
  corruptionSets?: number;
}

export interface UpdateOptions {
  fadeDuration?: number;
  effectEnabled?: boolean;
  resolutionScale?: number;
  blendFunction?: BlendFunction;
  buttonPressed?: boolean;
  lastButtonReleaseTime?: number;
  debugMode?: boolean;
  corruptionChunkCount?: number;
  corruptionStrength?: number;
  corruptionSpeed?: number;
  corruptionSets?: number;
}

/**
 * Effetto che crea una scia visiva mescolando i frame precedenti con quelli attuali
 */
export class DataMoshEffect extends Effect {
  private camera: THREE.Camera;
  private iFrameTexture = new THREE.Texture();
  private pFrameTexture = new THREE.Texture();
  private dFrameTexture = new THREE.Texture();
  private resolutionScale: number;
  private gl: THREE.WebGLRenderer | null = null;
  private blendFunctionType: BlendFunction;

  // Variabili per tracciare i cambiamenti della camera
  private previousCameraPosition = new THREE.Vector3();
  private previousCameraRotation = new THREE.Euler();
  private cameraChangeVector = new THREE.Vector3();

  constructor({
    fadeDuration = 370,
    effectEnabled = true,
    resolutionScale = 0.5,
    blendFunction = BlendFunction.LIGHTEN,
    camera,
    buttonPressed = false,
    lastButtonReleaseTime = 0,
    debugMode = false,
    corruptionChunkCount = 5,
    corruptionStrength = 1.1,
    corruptionSpeed = 200.0,
    corruptionSets = 30.0,
  }: DataMoshOptions) {
    // Definizione degli uniform per lo shader
    const uniforms = new Map<string, THREE.Uniform>([
      ["iFrame", new THREE.Uniform(null)],
      ["pFrame", new THREE.Uniform(null)],
      ["dFrame", new THREE.Uniform(null)],
      ["uTime", new THREE.Uniform(0)],
      ["fadeDuration", new THREE.Uniform(fadeDuration / 100)],
      ["effectEnabled", new THREE.Uniform(effectEnabled)],
      ["cameraMovement", new THREE.Uniform(new THREE.Vector3())],
      ["iResolution", new THREE.Uniform(new THREE.Vector2())],
      ["buttonPressed", new THREE.Uniform(buttonPressed)],
      ["lastButtonReleaseTime", new THREE.Uniform(lastButtonReleaseTime)],
      ["debugMode", new THREE.Uniform(debugMode)],
      ["corruptionChunkCount", new THREE.Uniform(corruptionChunkCount)],
      ["corruptionStrength", new THREE.Uniform(corruptionStrength)],
      ["corruptionSpeed", new THREE.Uniform(corruptionSpeed)],
      ["corruptionSets", new THREE.Uniform(corruptionSets)],
    ]);

    // Inizializzazione dell'effetto base con lo shader GLSL
    super("DataMosh", mainImageShader, {
      uniforms,
      blendFunction,
    });

    this.camera = camera;
    this.blendFunctionType = blendFunction;
    this.resolutionScale = resolutionScale;
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
    this.gl = renderer;

    // Imposta le dimensioni dei render target con la scala di risoluzione
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.setSize(size.width, size.height);
  }

  // Setter per le texture
  setIframeTexture(texture: THREE.Texture): void {
    this.iFrameTexture = texture;
  }

  setPFrameTexture(texture: THREE.Texture): void {
    this.pFrameTexture = texture;
  }

  setDFrameTexture(texture: THREE.Texture): void {
    this.dFrameTexture = texture;
  }

  /**
   * Calcola il vettore di cambiamento della camera
   */
  private calculateCameraChangeVector(camera: THREE.Camera): THREE.Vector3 {
    // Calculate position difference
    const positionDiff = new THREE.Vector3(
      camera.position.x - this.previousCameraPosition.x,
      camera.position.y - this.previousCameraPosition.y,
      camera.position.z - this.previousCameraPosition.z,
    );

    // Calculate rotation difference
    const rotationDiff = new THREE.Vector3(
      camera.rotation.x - this.previousCameraRotation.x,
      camera.rotation.y - this.previousCameraRotation.y,
      camera.rotation.z - this.previousCameraRotation.z,
    );

    const rotatedRotation = new THREE.Vector3(0, 0, 0);

    rotatedRotation.set(-rotationDiff.y, rotationDiff.x, rotationDiff.z);

    const positionChange = new THREE.Vector3(0, 0, 0);

    positionChange.copy(positionDiff);

    // Final vector: rotated rotation + position movement
    const finalChange = new THREE.Vector3().addVectors(
      rotatedRotation,
      positionChange,
    );

    // Update previous values
    this.previousCameraPosition.copy(camera.position);
    this.previousCameraRotation.copy(camera.rotation);

    return finalChange;
  }

  /**
   * Aggiorna l'effetto ad ogni frame
   */
  update(): void {
    if (this.camera) {
      this.cameraChangeVector = this.calculateCameraChangeVector(this.camera);
    }

    // Aggiorna il tempo
    this.uniforms.get("uTime")!.value = performance.now();

    // Aggiorna gli uniform con le texture correnti
    this.uniforms.get("iFrame")!.value = this.iFrameTexture;
    this.uniforms.get("pFrame")!.value = this.pFrameTexture;
    this.uniforms.get("dFrame")!.value = this.dFrameTexture;
    this.uniforms.get("cameraMovement")!.value = this.cameraChangeVector;
  }

  /**
   * Aggiorna le dimensioni dei render target
   */
  setSize(width: number, height: number): void {
    this.uniforms.get("iResolution")!.value = new THREE.Vector2(width, height);
  }

  /**
   * Aggiorna le opzioni dell'effetto
   */
  updateOptions(options: UpdateOptions): void {
    const {
      fadeDuration,
      effectEnabled,
      resolutionScale,
      blendFunction,
      buttonPressed,
      lastButtonReleaseTime,
      debugMode,
      corruptionChunkCount,
      corruptionStrength,
      corruptionSpeed,
      corruptionSets,
    } = options;

    if (fadeDuration !== undefined) {
      this.uniforms.get("fadeDuration")!.value = fadeDuration;
    }

    if (effectEnabled !== undefined) {
      this.uniforms.get("effectEnabled")!.value = effectEnabled;
    }

    if (buttonPressed !== undefined) {
      this.uniforms.get("buttonPressed")!.value = buttonPressed;
    }

    if (lastButtonReleaseTime !== undefined) {
      this.uniforms.get("lastButtonReleaseTime")!.value = lastButtonReleaseTime;
    }

    if (corruptionChunkCount !== undefined) {
      this.uniforms.get("corruptionChunkCount")!.value = corruptionChunkCount;
    }

    if (corruptionStrength !== undefined) {
      this.uniforms.get("corruptionStrength")!.value = corruptionStrength;
    }

    if (corruptionSpeed !== undefined) {
      this.uniforms.get("corruptionSpeed")!.value = corruptionSpeed;
    }

    if (corruptionSets !== undefined) {
      this.uniforms.get("corruptionSets")!.value = corruptionSets;
    }

    if (
      resolutionScale !== undefined &&
      resolutionScale !== this.resolutionScale
    ) {
      this.resolutionScale = resolutionScale;
      if (this.gl) {
        const size = this.gl.getDrawingBufferSize(new THREE.Vector2());
        this.setSize(size.width, size.height);
      }
    }

    if (
      blendFunction !== undefined &&
      blendFunction !== this.blendFunctionType
    ) {
      this.blendFunctionType = blendFunction;
      this.blendMode.blendFunction = blendFunction;
      this.blendMode.setBlendFunction(blendFunction);
    }

    if (debugMode !== undefined) {
      this.uniforms.get("debugMode")!.value = debugMode;
    }
  }
}
