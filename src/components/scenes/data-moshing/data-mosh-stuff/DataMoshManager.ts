import {
  CopyPass,
  DepthCopyPass,
  Effect,
  EffectComposer,
  EffectPass,
} from "postprocessing";
import * as THREE from "three";
import {
  cleanupFrameResources,
  createFrameRefs,
  setupFrameProcessing,
} from "./frame-processing";
import {
  DataMoshEffect,
  DataMoshOptions,
  UpdateOptions,
} from "./data-moshing-effect";

export class DataMoshManager {
  // Frame texture references
  private iFrameTextureRef!: THREE.Texture;
  private pFrameTextureRef!: THREE.Texture;
  private depthFrameTextureRef!: THREE.Texture;

  // Pass references
  private iFramePassRef!: CopyPass;
  private depthFramePassRef!: DepthCopyPass;
  private dataMoshEffectRef!: DataMoshEffect;
  private pFramePassRef!: CopyPass;

  // Create frame references
  private iFrameRefs = createFrameRefs();
  private pFrameRefs = createFrameRefs();
  private depthFrameRefs = createFrameRefs();

  private gl: THREE.WebGLRenderer;

  private cleanupFunctions: Array<(() => void) | undefined> = [];
  private options: DataMoshOptions;

  constructor(
    composer: EffectComposer,
    gl: THREE.WebGLRenderer,
    camera: THREE.Camera,
    options: DataMoshOptions,
  ) {
    // Add iFrame pass
    const iFramePass = new CopyPass();
    this.iFramePassRef = iFramePass;
    composer.addPass(iFramePass);

    // Add depth copy pass
    const depthCopyPass = new DepthCopyPass({
      depthPacking: THREE.BasicDepthPacking,
    });
    this.depthFramePassRef = depthCopyPass;
    composer.addPass(depthCopyPass);

    // Add trail effect
    const datamoshEffect = new DataMoshEffect(options);
    this.dataMoshEffectRef = datamoshEffect;
    composer.addPass(new EffectPass(camera, datamoshEffect));

    // Add pFrame pass
    const pFramePass = new CopyPass();
    this.pFramePassRef = pFramePass;
    composer.addPass(pFramePass);

    // Add display effect
    const displayEffect = new Effect(
      "DisplayEffect",
      `
            uniform sampler2D inputTexture;
            void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
                outputColor = texture2D(inputTexture, uv);
            }
            `,
      {
        uniforms: new Map([
          ["inputTexture", new THREE.Uniform(pFramePass.texture)],
        ]),
      },
    );
    composer.addPass(new EffectPass(camera, displayEffect));

    this.gl = gl;
    this.options = options;

    if (options.effectEnabled) {
      this.initRendering();
    }
  }

  initRendering() {
    if (!this.options.effectEnabled) return;

    const frameConfigs = [
      {
        refs: this.iFrameRefs,
        passRef: this.iFramePassRef,
        textureRef: this.iFrameTextureRef,
        name: "iFrame",
        setTexture: (texture: THREE.Texture) =>
          this.dataMoshEffectRef.setIframeTexture(texture),
      },
      {
        refs: this.pFrameRefs,
        passRef: this.pFramePassRef,
        textureRef: this.pFrameTextureRef,
        name: "pFrame",
        setTexture: (texture: THREE.Texture) =>
          this.dataMoshEffectRef.setPFrameTexture(texture),
        interval: 16,
      },
      {
        refs: this.depthFrameRefs,
        passRef: this.depthFramePassRef,
        textureRef: this.depthFrameTextureRef,
        name: "depthFrame",
        setTexture: (texture: THREE.Texture) =>
          this.dataMoshEffectRef.setDFrameTexture(texture),
        interval: 16,
      },
    ];

    // Configura tutti i frame e raccoglie le funzioni di cleanup
    this.cleanupFunctions = frameConfigs.map((config) =>
      setupFrameProcessing(
        this.gl,
        config.refs,
        config.passRef,
        config.textureRef,
        config.name,
        config.setTexture,
        this.options,
        this.dataMoshEffectRef,
        config.interval,
      ),
    );
  }

  updateOptions(options: UpdateOptions) {
    this.dataMoshEffectRef.updateOptions(options);

    if (options.fadeDuration != this.options.fadeDuration) {
      this.options.fadeDuration = options.fadeDuration;
    }
    if (options.effectEnabled != this.options.effectEnabled) {
      this.options.effectEnabled = options.effectEnabled;
    }
    if (options.resolutionScale != this.options.resolutionScale) {
      this.options.resolutionScale = options.resolutionScale;
    }
    if (options.blendFunction != this.options.blendFunction) {
      this.options.blendFunction = options.blendFunction;
    }
    if (options.buttonPressed != this.options.buttonPressed) {
      this.options.buttonPressed = options.buttonPressed;
    }
    if (options.lastButtonReleaseTime != this.options.lastButtonReleaseTime) {
      this.options.lastButtonReleaseTime = options.lastButtonReleaseTime;
    }
    if (options.debugMode != this.options.debugMode) {
      this.options.debugMode = options.debugMode;
      // If debug mode is being disabled, remove existing debug canvases
      if (!options.debugMode) {
        this.removeDebugCanvases();
      }
    }

    if (this.cleanupFunctions && options.effectEnabled === false) {
      this.destroy();
    }

    this.initRendering();
  }

  removeDebugCanvases() {
    [this.iFrameRefs, this.pFrameRefs, this.depthFrameRefs].forEach(ref => {
      if (ref.canvas) {
        ref.canvas.remove();
        ref.canvas = null;
      }
    });
  }

  // removeCanvas() {
  //     [this.pFrameRefs, this.iFrameRefs].forEach(ref => {
  //         if (ref.canvas) ref.canvas.remove();
  //     });
  // }

  destroy() {
    if (this.cleanupFunctions) {
      this.cleanupFunctions.forEach((cleanup) => cleanup && cleanup());
    }

    [this.iFrameRefs, this.pFrameRefs, this.depthFrameRefs].forEach(
      cleanupFrameResources,
    );
  }
}
