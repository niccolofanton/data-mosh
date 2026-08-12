import { BlendFunction, Effect } from "postprocessing";
import * as THREE from "three";
import { signalShader } from "./shaders/signal-shader";

export interface SignalSettings {
  /** How far colour smears sideways, from the chroma being carried at lower resolution. */
  chromaBleed: number;
  /** Colour arriving after the contour it belongs to, in pixels. */
  chromaDelay: number;
  /** Sensor persistence: the smear a moving highlight leaves behind it. */
  persistence: number;
  /** How strongly that trail favours highlights over the whole frame. */
  persistenceBias: number;
  /** How far off the floor the blacks sit: veiling glare plus limited range. */
  lift: number;
  /** Which way the lifted blacks lean. */
  liftTint: string;
  /** How far short of clipping the whites stop. */
  shoulder: number;
  contrast: number;
  saturation: number;
  /** Overall cast. */
  tint: string;
  vignette: number;
  grain: number;
}

/** Shape of the lost-vector regions, mirrored here only to outline them. */
export interface LostDebugSettings {
  enabled: boolean;
  density: number;
  layers: number;
  life: number;
  scale: number;
  aspect: number;
  variance: number;
}

/**
 * Signal stage: what happens to the picture after the encoder, on its way to
 * the screen.
 *
 * The persistence needs its own frame of history, which the manager supplies as
 * a render target it copies into after this pass has run. That target is the
 * shader's own previous output, so the trail compounds frame after frame and
 * settles into an exponential tail rather than a hard cut.
 */
export class SignalEffect extends Effect {
  private elapsed = 0;
  private readonly colour = new THREE.Color();

  constructor(settings: SignalSettings) {
    super("Signal", signalShader, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ["uTrail", new THREE.Uniform(null)],
        ["uTime", new THREE.Uniform(0)],
        ["uChromaBleed", new THREE.Uniform(settings.chromaBleed)],
        ["uChromaDelay", new THREE.Uniform(settings.chromaDelay)],
        ["uPersistence", new THREE.Uniform(settings.persistence)],
        ["uPersistenceBias", new THREE.Uniform(settings.persistenceBias)],
        ["uLift", new THREE.Uniform(settings.lift)],
        ["uLiftTint", new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ["uShoulder", new THREE.Uniform(settings.shoulder)],
        ["uContrast", new THREE.Uniform(settings.contrast)],
        ["uSaturation", new THREE.Uniform(settings.saturation)],
        ["uTint", new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ["uDebugLost", new THREE.Uniform(0)],
        ["uLostDensity", new THREE.Uniform(0)],
        ["uLostLayers", new THREE.Uniform(3)],
        ["uLostLife", new THREE.Uniform(180)],
        ["uLostScale", new THREE.Uniform(1)],
        ["uLostAspect", new THREE.Uniform(1)],
        ["uLostVariance", new THREE.Uniform(1)],
        ["uVignette", new THREE.Uniform(settings.vignette)],
        ["uGrain", new THREE.Uniform(settings.grain)],
      ]),
    });
  }

  setTrailTexture(texture: THREE.Texture): void {
    this.uniforms.get("uTrail")!.value = texture;
  }

  update(
    _renderer: THREE.WebGLRenderer,
    _inputBuffer: THREE.WebGLRenderTarget,
    deltaTime = 1 / 60,
  ): void {
    this.elapsed += THREE.MathUtils.clamp(deltaTime, 1 / 240, 1 / 15);
    this.uniforms.get("uTime")!.value = this.elapsed;
  }

  /** Reads a css colour into a uniform without allocating a new vector. */
  private setColourUniform(name: string, css: string): void {
    this.colour.set(css);
    (this.uniforms.get(name)!.value as THREE.Vector3).set(
      this.colour.r,
      this.colour.g,
      this.colour.b,
    );
  }

  /** Debug overlay: the regions whose vectors the datamosh dropped. */
  setLostDebug(lost: LostDebugSettings): void {
    this.uniforms.get("uDebugLost")!.value = lost.enabled ? 1 : 0;
    this.uniforms.get("uLostDensity")!.value = lost.density;
    this.uniforms.get("uLostLayers")!.value = lost.layers;
    this.uniforms.get("uLostLife")!.value = lost.life;
    this.uniforms.get("uLostScale")!.value = lost.scale;
    this.uniforms.get("uLostAspect")!.value = lost.aspect;
    this.uniforms.get("uLostVariance")!.value = lost.variance;
  }

  applySettings(settings: SignalSettings): void {
    this.uniforms.get("uChromaBleed")!.value = settings.chromaBleed;
    this.uniforms.get("uChromaDelay")!.value = settings.chromaDelay;
    this.uniforms.get("uPersistence")!.value = settings.persistence;
    this.uniforms.get("uPersistenceBias")!.value = settings.persistenceBias;
    this.uniforms.get("uLift")!.value = settings.lift;
    this.uniforms.get("uShoulder")!.value = settings.shoulder;
    this.uniforms.get("uContrast")!.value = settings.contrast;
    this.uniforms.get("uSaturation")!.value = settings.saturation;
    this.setColourUniform("uLiftTint", settings.liftTint);
    this.setColourUniform("uTint", settings.tint);
    this.uniforms.get("uVignette")!.value = settings.vignette;
    this.uniforms.get("uGrain")!.value = settings.grain;
  }
}
