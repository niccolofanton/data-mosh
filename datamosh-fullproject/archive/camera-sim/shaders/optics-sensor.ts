import { lensRemapGlsl } from "./lens-remap";

/**
 * Fragment shader of the optics + sensor stage.
 *
 * This is the *first* half of the camera chain and it runs BEFORE the datamosh,
 * which is the whole point of splitting it in two: everything here happens
 * between the light and the encoder, so the codec downstream gets to compress
 * an image that is already dirty. Grain a codec has chewed on reads as a
 * sensor; grain laid on top of a finished frame reads as a filter.
 *
 * Order inside the pass follows the physical path of the light:
 *
 *   lens        barrel distortion, lateral chromatic aberration
 *   shutter     rolling shutter skew - a geometric read order, not a lens effect
 *   readout     the exposure and white balance the automatics settled on
 *   amplifier   noise, scaled by the gain those automatics had to apply
 */
export const opticsSensorShader = /*glsl*/ `
    uniform float uTime;          // seconds

    // --- lens -----------------------------------------------------------
    uniform float uBarrel;        // k1: positive is barrel, the wide lens look
    uniform float uChromAb;       // lateral chromatic aberration, in pixels at the corner

    // --- sensor ---------------------------------------------------------
    uniform float uSkew;          // rolling shutter, driven by how fast the camera turns

    // --- automatics -----------------------------------------------------
    uniform float uExposure;      // multiplier the AE loop settled on this frame
    uniform vec3  uWhiteBalance;  // per channel gain from the AWB drift
    uniform float uGain;          // 0..1, how hard the AGC is pushing - drives the noise
    uniform float uNoise;         // base noise at zero gain
    uniform float uFixedPattern;  // share of the noise that does NOT change per frame

    float hash13(vec3 p3) {
        p3 = fract(p3 * 0.1031);
        p3 += dot(p3, p3.zyx + 31.32);
        return fract((p3.x + p3.y) * p3.z);
    }

    ${lensRemapGlsl}

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec2 distorted = lensRemap(uv);

        // Past the edge of the frame there is nothing to sample.
        if (distorted.x < 0.0 || distorted.x > 1.0 || distorted.y < 0.0 || distorted.y > 1.0) {
            outputColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
        }

        // Lateral chromatic aberration: the refractive index varies with
        // wavelength, so the channels land at slightly different scales. It
        // grows with the radius and is exactly zero in the centre - a constant
        // RGB offset across the whole frame is the giveaway of a fake.
        vec3 colour;
        if (uChromAb > 0.0) {
            vec2 fromCentre = distorted - 0.5;
            float spread = uChromAb / max(resolution.x, 1.0);
            colour.r = texture2D(inputBuffer, distorted + fromCentre * spread).r;
            colour.g = texture2D(inputBuffer, distorted).g;
            colour.b = texture2D(inputBuffer, distorted - fromCentre * spread).b;
        } else {
            colour = texture2D(inputBuffer, distorted).rgb;
        }

        // What the automatics decided this frame.
        colour *= uExposure;
        colour *= uWhiteBalance;

        // Noise rides on the gain, not on the clock. This coupling is what
        // sells a dark shot: an image that brightens without getting noisier
        // reads as a levels adjustment, because that is what it is.
        float amount = uNoise * (1.0 + uGain * 6.0);
        if (amount > 0.0) {
            // Part of the pattern is burnt into the sensor and does not change
            // between frames; the rest is shot noise and does.
            vec2 pixel = uv * resolution;
            float fixedNoise = hash13(vec3(pixel, 0.0)) - 0.5;
            float shotNoise = hash13(vec3(pixel, floor(uTime * 60.0))) - 0.5;
            float n = mix(shotNoise, fixedNoise, uFixedPattern);

            // The blue channel is always the worst: fewer useful photons, more
            // amplification to make up for it.
            colour += vec3(n, n * 0.9, n * 1.6) * amount;
        }

        outputColor = vec4(max(colour, 0.0), inputColor.a);
    }
`;
