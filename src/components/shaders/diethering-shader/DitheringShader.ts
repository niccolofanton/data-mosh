/**
 * Dithering shader implementation
 * Applies a dithering effect to the rendered scene
 */

const ditheringShader = /*glsl*/ `
uniform float ditheringEnabled;
uniform vec2 resolution;
uniform float gridSize;
uniform float luminanceMethod;
uniform float invertColor;
uniform float pixelationEnabled;
uniform float pixelSizeRatio;
uniform float grayscaleOnly;

/**
 * Determines if a pixel should be colored or not based on brightness and position
 */
bool getValue(float brightness, vec2 pos) {
  if (brightness > 16.0 / 17.0) return false;
  if (brightness < 1.0 / 17.0) return true;
  
  vec2 pixel = floor(mod(pos.xy / gridSize, 4.0));
  int x = int(pixel.x);
  int y = int(pixel.y);
  
  if (x == 0 && y == 0) return brightness < 16.0 / 17.0;
  if (x == 2 && y == 2) return brightness < 15.0 / 17.0;
  if (x == 2 && y == 0) return brightness < 14.0 / 17.0;
  if (x == 0 && y == 2) return brightness < 13.0 / 17.0;
  if (x == 1 && y == 1) return brightness < 12.0 / 17.0;
  if (x == 3 && y == 3) return brightness < 11.0 / 17.0;
  if (x == 3 && y == 1) return brightness < 10.0 / 17.0;
  if (x == 1 && y == 3) return brightness < 9.0 / 17.0;
  if (x == 1 && y == 0) return brightness < 8.0 / 17.0;
  if (x == 3 && y == 2) return brightness < 7.0 / 17.0;
  if (x == 3 && y == 0) return brightness < 6.0 / 17.0;
  if (x == 0 && y == 1) return brightness < 5.0 / 17.0;
  if (x == 1 && y == 2) return brightness < 4.0 / 17.0;
  if (x == 2 && y == 3) return brightness < 3.0 / 17.0;
  if (x == 2 && y == 1) return brightness < 2.0 / 17.0;
  if (x == 0 && y == 3) return brightness < 1.0 / 17.0;
  
  return false;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 fragCoord = uv * resolution;
  vec3 baseColor;

  if (pixelationEnabled > 0.0) {
    // Pixelation effect
    float pixelSize = gridSize * pixelSizeRatio;
    vec2 pixelatedUV = floor(fragCoord / pixelSize) * pixelSize / resolution;
    baseColor = texture2D(inputBuffer, pixelatedUV).rgb;

    // float lightBoost = 20.25; // 25% more light
    // baseColor = clamp(baseColor * lightBoost, 0.0, 1.0);
    
    // Calculate luminance for each pixel
    // float luminance = dot(baseColor, vec3(0.299, 0.587, 0.114));
    float luminance = dot(baseColor, vec3(1.,1.,1.));
    
    if (grayscaleOnly > 0.0) {
      baseColor = vec3(luminance);
    }
        
    // Apply dither pattern based on pixel position and luminance
    bool dithered = getValue(luminance, fragCoord);
    
    // Create dithered version of the pixel
    vec3 ditherColor = dithered ? vec3(0.0) : baseColor;
    
    // Apply dither only to the specific pixelated UV coordinate
    vec2 currentPixel = floor(fragCoord / pixelSize);
    vec2 originalPixel = floor(uv * resolution / pixelSize);
    
    baseColor = (currentPixel == originalPixel) ? ditherColor : baseColor;

  } else {
    baseColor = inputColor.rgb;
    
    if (grayscaleOnly > 0.0) {
      float luminance = dot(baseColor, vec3(0.299, 0.587, 0.114));
      baseColor = vec3(luminance);
    }
    
    float ditherLuminance = clamp(dot(baseColor, vec3(0.1, 0.6, 0.0722)), 0.1, 0.3);
    bool dithered = getValue(ditherLuminance, fragCoord);
    baseColor = mix(baseColor , vec3(0.0), float(dithered));

    // add more lighting to color
    // Aumenta la luminosità dei colori
    float lightIntensity = 1.2; // Fattore di intensità della luce
    baseColor = clamp(baseColor * lightIntensity, 0.0, 1.0);
  }

  if (invertColor > 0.0) {
    baseColor = 1.0 - baseColor;
  }

  // Add 25% more light to baseColor
  // float lightBoost = 7.25; // 25% more light
  // baseColor = clamp(baseColor * lightBoost, 0.0, 1.0);

  outputColor = vec4(baseColor, inputColor.a);
}`;

export default ditheringShader;
