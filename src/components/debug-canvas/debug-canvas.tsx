import * as THREE from "three";

let canvasIndex = 0;

export const addDebugCanvas = (
  texture: THREE.Texture,
  name: string = `Canvas ${canvasIndex}`,
) => {
  const canvas = document.createElement("canvas");
  canvas.width = window.innerWidth / 10;
  canvas.height = window.innerHeight / 10;

  canvas.style.position = "fixed";
  canvas.style.top = `${10 + canvasIndex * 10 + (window.innerHeight / 10) * canvasIndex}px`;
  canvas.style.left = "10px";
  canvas.style.zIndex = "1000";
  canvas.style.pointerEvents = "none";
  canvas.style.border = "1px solid white";
  canvas.title = name;

  document.body.appendChild(canvas);

  canvasIndex++;
  console.log("Added canvas", canvasIndex);

  return canvas;
};

export const updateDebugCanvas = (
  canvas: HTMLCanvasElement,
  texture: THREE.Texture,
  gl: THREE.WebGLRenderer,
) => {
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    console.log("No context found");
    return;
  }

  // if (canvas.title != 'pFrame') return;

  // Create temporary render target for texture rendering
  const renderTarget = new THREE.WebGLRenderTarget(
    canvas.width,
    canvas.height,
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    },
  );

  // Create temporary scene for texture rendering
  const tempScene = new THREE.Scene();
  const tempCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // Ensure texture parameters are set correctly
  if (texture) {
    texture.needsUpdate = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.format = THREE.RGBAFormat;
  }

  // Create plane with texture
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
  });

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);

  plane.rotateZ(Math.PI);
  tempScene.add(plane);

  // Render scene to render target
  gl.setRenderTarget(renderTarget);
  gl.render(tempScene, tempCamera);

  // Read pixels from render target
  const buffer = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readRenderTargetPixels(
    renderTarget,
    0,
    0,
    canvas.width,
    canvas.height,
    buffer,
  );

  // Uncomment to read pixel values: readValues(buffer)

  // Create image from pixel data
  const imageData = new ImageData(
    new Uint8ClampedArray(buffer),
    canvas.width,
    canvas.height,
  );
  ctx.putImageData(imageData, 0, 0);

  // Add title to canvas
  ctx.font = "10px Arial";
  ctx.fillStyle = "white";
  const now = new Date();
  const formattedTime = now.toLocaleTimeString("en-US", {
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
  ctx.fillText(canvas.title + " time:" + formattedTime, 5, 10);

  // Restore render target
  gl.setRenderTarget(null);

  // Clean up resources
  renderTarget.dispose();
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _readValues = (buffer: Uint8Array) => {
  // Generate random number between 0 and 1
  const randomValue = Math.random();
  if (randomValue > 0.03) return;

  // Find non-zero pixels directly from input buffer
  const nonZeroPixels: Array<{
    r: number;
    g: number;
    b: number;
    a: number;
    x: number;
    y: number;
  }> = [];

  for (let i = 0; i < buffer.length; i += 4) {
    const r = buffer[i];
    const g = buffer[i + 1];
    const b = buffer[i + 2];
    const a = buffer[i + 3];
    // && g > 20 && g < 80
    if (r == 255 && g == 25) {
      console.log(b);

      const pixelIndex = Math.floor(i / 4);
      const x = pixelIndex % window.innerWidth;
      const y = Math.floor(pixelIndex / window.innerWidth);
      nonZeroPixels.push({ r, g, b, a, x, y });
    }
  }

  // console.log('Non-zero pixels found:', nonZeroPixels);
};
