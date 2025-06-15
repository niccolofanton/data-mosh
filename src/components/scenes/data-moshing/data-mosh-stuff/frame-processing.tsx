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
  canvas: HTMLCanvasElement | null;
  lastCaptureTime: number;
  captureInterval: number;
}

// Create frame references
export const createFrameRefs = (): FrameRefs => ({
  renderTarget: null,
  renderScene: null,
  orthoCamera: null,
  material: null,
  plane: null,
  canvas: null,
  lastCaptureTime: 0,
  captureInterval: 16, // Default 16ms interval
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

// Check if frame should be captured based on timing
export const shouldCaptureFrame = (frameRefs: FrameRefs, currentTime: number): boolean => {
  return currentTime - frameRefs.lastCaptureTime >= frameRefs.captureInterval;
};

// Update frame capture timing
export const updateFrameCaptureTime = (frameRefs: FrameRefs, currentTime: number): void => {
  frameRefs.lastCaptureTime = currentTime;
};

// Process frame with timing control (to be called from useFrame)
export const processFrameWithTiming = (
  currentTime: number,
  gl: THREE.WebGLRenderer,
  frameRefs: FrameRefs,
  passRef: CopyPass | DepthCopyPass | null,
  textureRef: THREE.Texture | undefined,
  setTextureMethod: (texture: THREE.Texture) => void,
  option: DataMoshOptions,
  trailEffectRef?: object,
  frameName?: string,
): THREE.Texture | undefined => {
  // Only capture if enough time has passed and button is pressed
  if (!shouldCaptureFrame(frameRefs, currentTime) || !option.buttonPressed) {
    return undefined;
  }

  // Update capture time
  updateFrameCaptureTime(frameRefs, currentTime);

  // Process the frame
  const newTexture = processFrameTexture(
    gl,
    frameRefs,
    passRef,
    textureRef,
    setTextureMethod,
    option.buttonPressed,
    trailEffectRef,
    option.debugMode,
  );

  // Add debug canvas if needed
  if (newTexture && !frameRefs.canvas && option.debugMode && frameName) {
    frameRefs.canvas = addDebugCanvas(newTexture, frameName);
  }

  return newTexture;
};

// Setup frame processing (no longer uses setInterval)
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

  // Set the capture interval for this frame type
  if (interval > 0) {
    frameRefs.captureInterval = interval;
  }

  initializeFrameResources(frameRefs, passRef.texture);

  // Initial capture if button is pressed
  if (option.buttonPressed) {
    const newTexture = processFrameTexture(
      gl,
      frameRefs,
      passRef,
      textureRef,
      setTextureMethod,
      option.buttonPressed,
      trailEffectRef,
      option.debugMode,
    );

    if (newTexture && !frameRefs.canvas && option.debugMode) {
      frameRefs.canvas = addDebugCanvas(newTexture, frameName);
    }
  }

  // Return cleanup function (no more timer to clean up)
  return () => {
    // No timer cleanup needed anymore
  };
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
