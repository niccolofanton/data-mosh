// Main GLSL shader for the data moshing effect
export const mainImageShader = /*glsl*/ `
    uniform sampler2D iFrame;
    uniform sampler2D pFrame;
    uniform sampler2D dFrame;
    uniform float debug; 
    uniform bool debugMode;
    uniform float uTime; // Time in milliseconds
    uniform float lastButtonReleaseTime; // Time when button was last released
    uniform vec2 iResolution; // Canvas resolution
    uniform float fadeDuration;
    
    uniform bool buttonPressed; // Button state
    uniform bool initState; 
    
    uniform bool effectEnabled;
    uniform vec3 cameraMovement;

    // Random Perlin noise generator
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    int getDebug(vec2 uv){
        // Calculate the position of the current pixel
        vec2 pixelPos = uv * iResolution;
        // Debug is active on the entire first row
        return pixelPos.x < 10.0 && pixelPos.y < 10.0 ? 1 : 0;
    }

    vec3 adjustContrast(vec3 color, float contrast) {
        // Shift the color so that mid-gray (0.5) is the pivot point for contrast
        return (color - 0.5) * contrast + 0.5;
    }

    // Define 5 sets of 10 areas each with square/rectangular shapes
    // Max size is now approx 0.07 (25% of previous max 0.28)
    // SET 1: Varied central patterns
    // SET 1: Completely random scatter
    vec3 areaSet1[10] = vec3[](
        vec3(0.092, 0.451, 0.021),    
        vec3(0.783, 0.219, 0.035),    
        vec3(0.367, 0.935, 0.015),    
        vec3(0.612, 0.147, 0.0275),   
        vec3(0.024, 0.589, 0.0125),   
        vec3(0.941, 0.336, 0.03),     
        vec3(0.275, 0.698, 0.0175),   
        vec3(0.503, 0.084, 0.025),    
        vec3(0.836, 0.521, 0.0325),   
        vec3(0.152, 0.867, 0.01)      
    );
    
    vec3 areaSet2[10] = vec3[](
        vec3(0.431, 0.729, 0.0225),   
        vec3(0.065, 0.982, 0.0275),   
        vec3(0.893, 0.248, 0.032),    
        vec3(0.526, 0.371, 0.018),    
        vec3(0.197, 0.604, 0.0075),   
        vec3(0.742, 0.013, 0.03),     
        vec3(0.318, 0.854, 0.0125),   
        vec3(0.956, 0.493, 0.025),    
        vec3(0.103, 0.175, 0.0175),   
        vec3(0.674, 0.762, 0.021)     
    );
    
    vec3 areaSet3[10] = vec3[](
        vec3(0.489, 0.125, 0.0275),   
        vec3(0.913, 0.642, 0.02),     
        vec3(0.271, 0.074, 0.0325),   
        vec3(0.758, 0.395, 0.015),    
        vec3(0.034, 0.917, 0.0225),   
        vec3(0.563, 0.236, 0.03),     
        vec3(0.821, 0.538, 0.0175),   
        vec3(0.349, 0.803, 0.0275),   
        vec3(0.132, 0.671, 0.01),     
        vec3(0.697, 0.291, 0.035)     
    );
    
    vec3 areaSet4[10] = vec3[](
        vec3(0.583, 0.027, 0.025),    
        vec3(0.214, 0.769, 0.0175),   
        vec3(0.865, 0.413, 0.03),     
        vec3(0.478, 0.952, 0.0125),   
        vec3(0.051, 0.326, 0.0275),   
        vec3(0.732, 0.578, 0.02),     
        vec3(0.384, 0.159, 0.033),    
        vec3(0.927, 0.684, 0.015),    
        vec3(0.165, 0.841, 0.0225),   
        vec3(0.643, 0.205, 0.01)      
    );
    
    vec3 areaSet5[10] = vec3[](
        vec3(0.795, 0.617, 0.035),    
        vec3(0.237, 0.034, 0.0275),   
        vec3(0.561, 0.891, 0.02),     
        vec3(0.078, 0.745, 0.0175),   
        vec3(0.423, 0.281, 0.025),    
        vec3(0.971, 0.463, 0.0325),   
        vec3(0.302, 0.548, 0.015),    
        vec3(0.118, 0.973, 0.0225),   
        vec3(0.649, 0.192, 0.01),     
        vec3(0.507, 0.836, 0.0075)    
    );

    // Function to determine if a point is inside one of the areas of the current set
    bool isInCurrentSet(vec2 uv, int setIndex) {
        for (int i = 0; i < 10; i++) {
            vec3 area;
            
            if (setIndex == 0) {
                area = areaSet1[i];
            } else if (setIndex == 1) {
                area = areaSet2[i];
            } else if (setIndex == 2) {
                area = areaSet3[i];
            } else if (setIndex == 3) {
                area = areaSet4[i];
            } else {
                area = areaSet5[i];
            }
            
            // Extract position and size from the area
            vec2 areaPos = area.xy;
            float areaSize = area.z;
            
            // Small variation to make edges less perfect
            float edgeNoise = random(areaPos + vec2(uv.y, uv.x) + uTime * 0.0001) * 0.005;
            
            // Check if uv is inside this rectangular area
            if (uv.x > areaPos.x - areaSize - edgeNoise && 
                uv.x < areaPos.x + areaSize + edgeNoise && 
                uv.y > areaPos.y - areaSize - edgeNoise && 
                uv.y < areaPos.y + areaSize + edgeNoise) {
                return true;
            }
        }
        return false;
    }

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        // Early return if effect is disabled
        if (!effectEnabled) {
            outputColor = inputColor;
            return;
        }

        int debug = getDebug(uv);

        // Pixelization parameters
        const float pixelSize = 64.0;
        vec2 uvPixelized = round(uv * pixelSize) / pixelSize;

        float noise = random(uvPixelized + uTime * 0.001);
        
        // Calculate depth for displacement
        vec4 oDepth = texture2D(dFrame, uv);
        float depth = -pow(oDepth.r, 2.0) * 5.0; // Amplify the final value

        // Calculate displacement based on camera movement
        vec2 offset = -cameraMovement.xy * depth;
        
        // Change area set every 200ms
        int currentSetIndex = int(mod(uTime / 200.0, 5.0));
        
        // Determine final coordinates based on noise and pixelization
        vec2 finalUV;
        
        // Check if the current point is in one of the active areas
        if (isInCurrentSet(uv, currentSetIndex) && cameraMovement.x != 0. && cameraMovement.y != 0.) {
            // If in an area, apply pixelization
            finalUV = uvPixelized;
        } else {
            // Otherwise, apply the datamosh effect as usual
            finalUV = uv + offset;
        }
        
        // Sample the current frame with calculated coordinates
        vec4 moshedColor = texture2D(iFrame, finalUV);
        vec4 pFrameColor = texture2D(pFrame, finalUV);

        // Handle the case of the first frame (without previous frame)
        if (initState) {
            outputColor = moshedColor;
            return;
        }

        if (lastButtonReleaseTime == -1.) {
            // outputColor = vec4(pFrameColor.rgb, 1.0);
            // Make the image lighter based on oDepth value
            float darkenAmount = oDepth.r * 0.0075;
            vec3 darkenedColor = mix(pFrameColor.rgb, vec3(0.0), darkenAmount);
            outputColor = vec4(darkenedColor, 1.0);
            return;
        }

        // Calculate the time since the button was last released
        float timeSinceRelease = (uTime - lastButtonReleaseTime) / 1000.0; // Convert to seconds
        
        // Calculate the mix factor based on the time since release
        float mixFactor = clamp(timeSinceRelease / (fadeDuration / 1000.), 0.0, 1.0);
        
        // Mix the colors based on the calculated factor
        outputColor = mix(vec4(pFrameColor.rgb, 1.0), inputColor, mixFactor);
    }
`;
