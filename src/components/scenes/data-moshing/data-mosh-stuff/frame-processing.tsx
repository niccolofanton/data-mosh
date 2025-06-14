import * as THREE from "three";
import { CopyPass, DepthCopyPass } from "postprocessing";
import { updateDebugCanvas, addDebugCanvas } from '../../../debug-canvas/debug-canvas';
import { DataMoshOptions } from "./data-moshing-effect";

// Frame rendering references - struttura per entrambi i frame i e p
export interface FrameRefs {
  renderTarget: THREE.WebGLRenderTarget | null;
  renderScene: THREE.Scene | null;
  orthoCamera: THREE.OrthographicCamera | null;
  material: THREE.MeshBasicMaterial | null;
  plane: THREE.Mesh | null;
  timer: NodeJS.Timeout | null;
  canvas: HTMLCanvasElement | null;
}

// Create frame references
export const createFrameRefs = (): FrameRefs => ({
  renderTarget: null,
  renderScene: null,
  orthoCamera: null,
  material: null,
  plane: null,
  timer: null,
  canvas: null,
});

// Initialize frame resources
export const initializeFrameResources = (
  frameRefs: FrameRefs,
  texture: THREE.Texture,
) => {
  if (!frameRefs.renderTarget) {
    frameRefs.renderTarget = new THREE.WebGLRenderTarget(
      texture.image.width,
      texture.image.height,
      {
        minFilter: texture.minFilter,
        magFilter: texture.magFilter,
        format: texture.format,
        type: texture.type,
      },
    );
  }

  if (!frameRefs.renderScene) {
    frameRefs.renderScene = new THREE.Scene();
  }

  if (!frameRefs.orthoCamera) {
    frameRefs.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  if (!frameRefs.material) {
    frameRefs.material = new THREE.MeshBasicMaterial({ map: texture });
    frameRefs.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      frameRefs.material,
    );
    frameRefs.renderScene.add(frameRefs.plane);
  }
};

// Process frame texture
export const processFrameTexture = (
  gl: THREE.WebGLRenderer,
  frameRefs: FrameRefs,
  passRef: CopyPass | DepthCopyPass | null,
  textureRef: THREE.Texture | undefined,
  setTextureMethod: (texture: THREE.Texture) => void,
  buttonPressed: boolean,
  trailEffectRef?: object,
  debugMode?: boolean,
) => {
  if (!passRef || !buttonPressed) return;

  // Reset texture reference
  if (textureRef) {
    textureRef = undefined;
  }

  // Check required references
  if (
    !trailEffectRef ||
    !passRef?.texture ||
    !frameRefs.renderTarget ||
    !frameRefs.renderScene ||
    !frameRefs.orthoCamera ||
    !frameRefs.material
  )
    return undefined;

  // Update material and render
  frameRefs.material.map = passRef.texture;
  frameRefs.material.needsUpdate = true;

  gl.setRenderTarget(frameRefs.renderTarget);
  gl.render(frameRefs.renderScene, frameRefs.orthoCamera);
  gl.setRenderTarget(null);

  const newTexture = frameRefs.renderTarget.texture;

  if (newTexture && trailEffectRef) {
    textureRef = newTexture;

    if (frameRefs.canvas && debugMode) {
      updateDebugCanvas(frameRefs.canvas, newTexture, gl);
    }

    setTextureMethod(newTexture);
    return newTexture;
  }
};

// Setup frame processing
export const setupFrameProcessing = (
  gl: THREE.WebGLRenderer,
  frameRefs: FrameRefs,
  passRef: CopyPass | DepthCopyPass | null,
  textureRef: THREE.Texture | undefined,
  frameName: string,
  setTextureMethod: (texture: THREE.Texture) => void,
  option: DataMoshOptions,
  trailEffectRef?: object,
  interval: number = 0,
) => {
  if (!passRef?.texture) return;

  initializeFrameResources(frameRefs, passRef.texture);

  const processTexture = () => {
    if (option.buttonPressed) {
      return processFrameTexture(
        gl,
        frameRefs,
        passRef,
        textureRef,
        setTextureMethod,
        option.buttonPressed,
        trailEffectRef,
        option.debugMode,
      );
    }
  };

  const newTexture = processTexture();

  if (newTexture && !frameRefs.canvas && option.debugMode) {
    frameRefs.canvas = addDebugCanvas(newTexture, frameName);
  }

  if (interval) {
    if (frameRefs.timer) {
      clearInterval(frameRefs.timer);
    }

    frameRefs.timer = setInterval(processTexture, interval);

    return () => {
      if (frameRefs.timer) {
        clearInterval(frameRefs.timer);
        frameRefs.timer = null;
      }
    };
  }
};

// Cleanup frame resources
export const cleanupFrameResources = (frameRefs: FrameRefs) => {
  if (frameRefs.renderTarget) {
    frameRefs.renderTarget.dispose();
  }
  if (frameRefs.material) {
    frameRefs.material.dispose();
  }
  if (frameRefs.plane?.geometry) {
    frameRefs.plane.geometry.dispose();
  }
  if (frameRefs.canvas) {
    frameRefs.canvas.remove();
    frameRefs.canvas = null;
  }
};
