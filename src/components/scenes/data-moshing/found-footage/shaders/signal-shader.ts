/**
 * Fragment shader of the signal stage.
 *
 * Second half of the camera chain, and it runs AFTER the datamosh: everything
 * modelled here happens to a picture that has already been encoded, either on
 * the way out of the codec or on the way to the screen.
 *
 *   chroma      the colour planes are carried at a fraction of the luma
 *               resolution, so colour smears sideways and arrives slightly
 *               after the contour it belongs to
 *   persistence the smear a slow sensor leaves behind a moving highlight -
 *               weighted by brightness, because that is where it is visible
 *   display     vignette and grain
 *
 * The persistence is a feedback loop: `uTrail` is this shader's own output from
 * the previous frame. It is an IIR filter, so it settles rather than diverging,
 * and weighting it by luminance is what keeps it from turning the whole frame
 * into mush - a real sensor holds onto bright things, not dark ones.
 */
export const signalShader = /*glsl*/ `
    uniform sampler2D uTrail;     // this effect's output, one frame ago
    uniform float uTime;          // seconds

    uniform float uChromaBleed;   // how far the colour smears horizontally
    uniform float uChromaDelay;   // colour lagging behind the contours, in pixels

    uniform float uPersistence;   // 0 = none, 1 = the image never lets go
    uniform float uPersistenceBias; // how strongly the trail favours highlights

    // --- grade ------------------------------------------------------------
    uniform float uLift;          // how far off the floor the blacks sit
    uniform vec3  uLiftTint;      // and which way they lean while they are there
    uniform float uShoulder;      // how far short of clipping the whites stop
    uniform float uContrast;
    uniform float uSaturation;
    uniform vec3  uTint;          // overall cast

    // Lost-vector debug overlay. It lives here, downstream of the feedback
    // copy, because the datamosh writes into the buffer the next frame predicts
    // from: an outline drawn there is dragged and redrawn every frame until the
    // screen is white.
    uniform float uDebugLost;
    uniform float uLostDensity;
    uniform float uLostLayers;
    uniform float uLostLife;
    uniform float uLostScale;
    uniform float uLostAspect;
    uniform float uLostVariance;

    uniform float uVignette;
    uniform float uGrain;

    float hash13(vec3 p3) {
        p3 = fract(p3 * 0.1031);
        p3 += dot(p3, p3.zyx + 31.32);
        return fract((p3.x + p3.y) * p3.z);
    }

    vec2 hash23(vec3 p3) {
        p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.xx + p3.yz) * p3.zy);
    }

    /** Same regions the datamosh computes, re-derived here for the outline. */
    float lostEdge(const in vec2 uv) {
        if (uLostDensity <= 0.0) return 0.0;

        for (int i = 0; i < 4; i++) {
            float fi = float(i);
            if (fi >= uLostLayers) break;

            vec2 cells = vec2(7.0, 5.0) * (1.0 + fi * 1.6) / max(uLostScale, 0.05);
            vec2 cellId = floor(uv * cells);
            vec2 inCell = fract(uv * cells);

            float phase = hash13(vec3(cellId, fi + 5.0));
            float t = uTime * 1000.0 / max(uLostLife, 16.0) + phase;
            float slot = floor(t);
            float age = fract(t);

            if (hash13(vec3(cellId, slot * 7.0 + fi)) > uLostDensity) continue;

            vec2 centre = 0.2 + hash23(vec3(cellId, slot + fi * 23.0)) * 0.6;
            vec2 stretch = vec2(uLostAspect, 1.0 / max(uLostAspect, 0.05));
            vec2 halfSize = (0.05 + hash23(vec3(cellId, slot + fi * 41.0))
                             * vec2(0.45, 0.26) * uLostVariance) * stretch;

            vec2 d = abs(inCell - centre);
            if (d.x > halfSize.x || d.y > halfSize.y) continue;
            if (age > 0.12 + hash13(vec3(cellId, slot + 61.0)) * 0.45) continue;

            float edge = min((halfSize.x - d.x) / cells.x * resolution.x,
                             (halfSize.y - d.y) / cells.y * resolution.y);
            return step(edge, 1.5);
        }

        return 0.0;
    }

    float luma(vec3 c) {
        return dot(c, vec3(0.299, 0.587, 0.114));
    }

    // BT.601: luma and chroma kept apart, the way every codec and every
    // broadcast standard does it.
    vec3 rgbToYcc(vec3 c) {
        return vec3(
            dot(c, vec3(0.299, 0.587, 0.114)),
            dot(c, vec3(-0.168736, -0.331264, 0.5)),
            dot(c, vec3(0.5, -0.418688, -0.081312))
        );
    }

    vec3 yccToRgb(vec3 c) {
        return vec3(
            c.x + 1.402 * c.z,
            c.x - 0.344136 * c.y - 0.714136 * c.z,
            c.x + 1.772 * c.y
        );
    }

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 colour = inputColor.rgb;

        // --- chroma: full bandwidth luma, a fraction of it for colour -------
        if (uChromaBleed > 0.0) {
            vec3 chroma = vec3(0.0);
            float width = uChromaBleed * 18.0 / resolution.x;

            for (int i = 0; i < 9; i++) {
                float t = float(i) / 8.0 - 0.5;
                vec2 tap = vec2(uv.x + t * width - uChromaDelay / resolution.x, uv.y);
                chroma += rgbToYcc(texture2D(inputBuffer, clamp(tap, 0.001, 0.999)).rgb);
            }
            chroma /= 9.0;

            vec3 ycc = rgbToYcc(colour);
            colour = yccToRgb(vec3(ycc.x, chroma.y, chroma.z));
        }

        // --- grade -----------------------------------------------------------
        // The washed look of real footage is not a stylistic choice, it is two
        // physical facts stacked on top of each other.
        //
        // First, video is not full range: the standards put black at 16 and
        // white at 235 out of 255, and cheap hardware routinely fails to expand
        // it back on playback. The picture therefore arrives with its floor
        // already lifted and its ceiling already lowered.
        //
        // Second, veiling glare - light scattered inside a small, uncoated,
        // usually smudged lens - adds a roughly uniform sheet of light across
        // the whole frame. It does nothing to the highlights and everything to
        // the shadows, which is why the blacks of a body-worn camera are milky
        // and slightly the colour of whatever is brightest in the room.
        //
        // Remapping the range reproduces both, and it has to happen before the
        // saturation so the desaturation acts on the flattened image rather
        // than on a contrast it no longer has.
        colour = mix(uLift * uLiftTint, vec3(1.0 - uShoulder), colour);
        colour = (colour - 0.5) * uContrast + 0.5;

        float grey = luma(colour);
        colour = mix(vec3(grey), colour, uSaturation);
        colour *= uTint;

        // --- persistence ----------------------------------------------------
        if (uPersistence > 0.0) {
            vec3 previous = texture2D(uTrail, uv).rgb;

            // Only what was bright leaves a trail, and the trail is taken as a
            // maximum rather than a blend: a highlight that has moved on should
            // fade from where it was, not darken what is there now.
            float weight = uPersistence
                         * mix(1.0, smoothstep(0.25, 0.85, luma(previous)), uPersistenceBias);

            colour = max(colour, previous * weight);
        }

        // --- display ---------------------------------------------------------
        if (uVignette > 0.0) {
            vec2 centred = (uv - 0.5) * vec2(aspect, 1.0);
            float r = length(centred) / 0.72;
            colour *= 1.0 - uVignette * pow(clamp(r, 0.0, 1.0), 2.5);
        }

        if (uGrain > 0.0) {
            float g = hash13(vec3(uv * resolution, floor(uTime * 60.0) + 17.0)) - 0.5;
            colour += g * uGrain;
        }

        if (uDebugLost > 0.5) {
            colour = mix(colour, vec3(1.0), lostEdge(uv));
        }

        outputColor = vec4(clamp(colour, 0.0, 1.0), inputColor.a);
    }
`;
