// Main GLSL shader for the data moshing effect
export const mainImageShader = /*glsl*/ `
    uniform sampler2D iFrame;
    uniform sampler2D pFrame;
    uniform sampler2D dFrame;
    uniform float uTime; // Time in milliseconds
    uniform float lastButtonReleaseTime; // Time when button was last released
    uniform vec2 iResolution; // Canvas resolution
    uniform float fadeDuration;
    uniform bool buttonPressed; // Button state
    uniform bool effectEnabled;
    uniform vec3 cameraMovement;
    uniform int corruptionChunkCount; // Number of corruption chunks (1-200)
    uniform float corruptionStrength; // Corruption effect intensity (0.0-2.0)
    uniform float corruptionSpeed; // Speed of corruption set changes (1.0-1000.0)
    uniform float corruptionSets; // Number of corruption sets (1.0-1000.0)

    // Hash function for pseudo-random number generation
    float hash(float n) {
        return fract(sin(n) * 43758.5453123);
    }
    
    // 2D hash function
    vec2 hash2(float n) {
        return fract(sin(vec2(n, n + 1.0)) * vec2(43758.5453123, 22578.1459123));
    }
    
    // 3D hash function  
    vec3 hash3(float n) {
        return fract(sin(vec3(n, n + 1.0, n + 2.0)) * vec3(43758.5453123, 22578.1459123, 19134.1031415));
    }

    // Function to generate corruption factor for variable number of rectangles/squares
    float getCorruptionFactor(vec2 uv, int setIndex) {
        float corruptionFactor = 0.0;
        float seed = float(setIndex) * 12345.6789; // Use setIndex as base seed
        
        // Use configurable chunk count (clamped to reasonable range)
        int chunkCount = clamp(corruptionChunkCount, 1, 200);
        
        // Generate rectangles/squares based on chunk count
        for (int i = 0; i < 200; i++) {
            if (i >= chunkCount) break; // Dynamic loop termination
            
            float currentSeed = seed + float(i) * 7.123456;
            
            // Generate random center position (0.0 to 1.0)
            vec2 center = hash2(currentSeed);
            
            // Generate random dimensions (mix of squares and rectangles)
            vec3 sizeData = hash3(currentSeed + 100.0);
            float baseSize = 0.02 + sizeData.x * 0.08; // Base size: 0.02 to 0.1
            
            // Determine if it's a square or rectangle
            bool isSquare = sizeData.y > 0.4; // 60% chance for rectangles, 40% for squares
            
            vec2 rectSize;
            if (isSquare) {
                rectSize = vec2(baseSize, baseSize);
            } else {
                // Rectangle with random aspect ratio
                float aspectRatio = 0.3 + sizeData.z * 1.4; // Aspect ratio: 0.3 to 1.7
                rectSize = vec2(baseSize, baseSize * aspectRatio);
                
                // Randomly swap width/height for variety
                if (hash(currentSeed + 200.0) > 0.5) {
                    rectSize = rectSize.yx;
                }
            }
            
            // Check if current UV is inside this rectangle
            vec2 offset = abs(uv - center);
            if (offset.x < rectSize.x * 0.5 && offset.y < rectSize.y * 0.5) {
                // Generate corruption intensity based on rectangle properties
                float intensity = 0.3 + hash(currentSeed + 300.0) * 0.7; // 0.3 to 1.0
                
                // Add some variation based on position within rectangle
                vec2 normalizedPos = offset / (rectSize * 0.5); // 0.0 to 1.0 within rect
                float positionVariation = sin(normalizedPos.x * 3.14159) * sin(normalizedPos.y * 3.14159);
                intensity *= (0.7 + positionVariation * 0.3);
                
                // Apply corruption strength multiplier
                intensity *= corruptionStrength;
                
                // Accumulate corruption (allows overlapping effects)
                corruptionFactor = max(corruptionFactor, intensity);
            }
        }
        
        return clamp(corruptionFactor, 0.0, 1.0);
    }
    
    // Function to get corruption color variation
    vec3 getCorruptionColorShift(vec2 uv, int setIndex, float corruptionFactor) {
        if (corruptionFactor <= 0.0) return vec3(1.0);
        
        float seed = float(setIndex) * 9876.543 + uv.x * 1234.5 + uv.y * 5678.9;
        vec3 colorShift = hash3(seed);
        
        // Create more dramatic color shifts for stronger corruption
        float shiftIntensity = corruptionFactor * corruptionStrength * 0.8;
        colorShift = mix(vec3(1.0), colorShift * 2.0 - 1.0, shiftIntensity);
        
        // Bias towards certain corruption colors (reds, greens, magentas)
        if (colorShift.r > 0.5) colorShift.r *= 1.5;
        if (colorShift.g > 0.6) colorShift.g *= 1.3;
        colorShift.b *= 0.7; // Reduce blue for more datamosh-like effect
        
        return clamp(colorShift, 0.1, 2.0);
    }

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        if (!effectEnabled) {
            outputColor = inputColor;
            return;
        }

        vec4 oDepth = texture2D(dFrame, uv);
        vec2 finalUV;
        vec4 pFrameColor;
        int currentSetIndex = int(mod(uTime / corruptionSpeed, corruptionSets));
        
        // Get corruption factor instead of boolean check
        float corruptionFactor = getCorruptionFactor(uv, currentSetIndex);
        
        if (corruptionFactor > 0.0 && cameraMovement.x != 0. && cameraMovement.y != 0.) {
            // Apply corruption effect with varying intensity based on strength
            float basePixelSize = 32.0;
            float maxPixelSize = 64.0 * corruptionStrength; // Scale max pixelization with strength
            float pixelSize = basePixelSize + corruptionFactor * maxPixelSize;
            vec2 uvPixelized = round(uv * pixelSize) / pixelSize;
            finalUV = uvPixelized;
            pFrameColor = texture2D(iFrame, finalUV);
            
            // Apply color corruption
            vec3 colorShift = getCorruptionColorShift(uv, currentSetIndex, corruptionFactor);
            pFrameColor.rgb *= colorShift;
            
            // Add digital noise with strength-based threshold
            float noise = hash(uv.x * 1000.0 + uv.y * 1000.0 + uTime * 0.01);
            float noiseThreshold = 0.95 - (corruptionStrength - 1.0) * 0.2; // Lower threshold for higher strength
            if (corruptionFactor > 0.7 && noise > noiseThreshold) {
                float noiseMix = 0.3 * corruptionStrength; // Stronger noise with higher strength
                pFrameColor.rgb = mix(pFrameColor.rgb, vec3(noise), noiseMix);
            }
        } else {
            float depth = -pow(oDepth.r, 2.0) * 5.0;
            vec2 offset = -cameraMovement.xy * depth;
            finalUV = uv + offset;
            pFrameColor = texture2D(pFrame, finalUV);
        }

        if (lastButtonReleaseTime == -1.) {
            float darkenAmount = oDepth.r * 0.0095;
            vec3 darkenedColor = mix(pFrameColor.rgb, vec3(0.0), darkenAmount);
            outputColor = vec4(darkenedColor, 1.0);
            return;
        }

        float timeSinceRelease = (uTime - lastButtonReleaseTime) / 1000.0;
        float mixFactor = clamp(timeSinceRelease / (fadeDuration / 1000.), 0.0, 1.0);
        outputColor = mix(vec4(pFrameColor.rgb, 1.0), inputColor, mixFactor);
    }
`;
