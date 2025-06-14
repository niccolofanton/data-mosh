// post processing - unused for now
// const firstPassFs = /*glsl*/` ...

export const secondPassFs = /*glsl*/ `
  #ifdef GL_ES
  precision mediump float;
  #endif

  varying vec3 vVertexPosition;
  varying vec2 vTextureCoord;

  uniform sampler2D uRenderTexture;

  uniform float uScrollEffect;

  void main() {
    vec2 textureCoords = vTextureCoord;
    vec2 texCenter = vec2(0.5, 0.5);

    // distort around scene center
    textureCoords += vec2(texCenter - textureCoords).xy * sin(distance(texCenter, textureCoords)) * uScrollEffect / 175.0;

    gl_FragColor = texture2D(uRenderTexture, textureCoords);
  }
`;

export const vertexShader = /*glsl*/ `
  precision mediump float;
      
  attribute vec3 aVertexPosition;
  attribute vec2 aTextureCoord;

  uniform mat4 uMVMatrix;
  uniform mat4 uPMatrix;

  uniform mat4 planeTextureMatrix;

  varying vec3 vVertexPosition;
  varying vec2 vTextureCoord;

  uniform float uPlaneDeformation;

  void main() {
    vec3 vertexPosition = aVertexPosition;

    // cool effect on scroll
    vertexPosition.y += sin(((vertexPosition.x + 1.0) / 2.0) * 3.141592) * (sin(uPlaneDeformation / 90.0));

    gl_Position = uPMatrix * uMVMatrix * vec4(vertexPosition, 1.0);
    
    // varyings
    vVertexPosition = aVertexPosition;
    vTextureCoord = (planeTextureMatrix * vec4(aTextureCoord, 0.0, 1.0)).xy;
  }
`;

export const fragmentShader = /*glsl*/ `
  precision mediump float;

  varying vec3 vVertexPosition;
  varying vec2 vTextureCoord;
  
  uniform sampler2D planeTexture;
  
  void main() {
    gl_FragColor = texture2D(planeTexture, vTextureCoord);
  }
`;
