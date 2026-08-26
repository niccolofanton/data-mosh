/**
 * Fragment shader of the data moshing effect.
 *
 * The effect emulates what a decoder does when the keyframes of a compressed
 * video are removed: the motion vectors of the incoming frames keep being
 * applied, but to the wrong picture. Here the "wrong picture" is `pFrame`, the
 * previous output of this very effect, and the motion vectors come either from
 * a screen space velocity buffer (`uVelocity`, which measures camera *and*
 * object movement, like a real block matching search would) or, as a cheaper
 * fallback, from an exact reprojection of the depth buffer through the camera
 * transform of the previous frame.
 *
 * The decoder loop being reproduced is `new = warp(previous, mv) + residual`,
 * and all three terms are modelled:
 *
 *   warp      the block quantised motion vector, snapped to the sub pixel grid
 *             a codec actually stores (half pel in MPEG-4 Part 2)
 *   previous  pFrame, i.e. content that belongs to another shot
 *   residual  the high frequencies of the *incoming* picture, quantised with a
 *             dead zone. It is what paints the ghosts of the new scene over the
 *             old one, and by being re-added on every frame of the chain it is
 *             also what drives the image towards clipping
 *
 * Everything that makes it read as a *datamosh* rather than as a liquid smear
 * happens on the macroblock grid: the motion vector is evaluated once per
 * block, snapped, and then applied to every pixel of that block, so blocks
 * slide as rigid tiles and disagree with their neighbours.
 *
 * Uniforms provided for free by postprocessing's EffectMaterial and used here:
 *   inputBuffer, resolution, aspect, cameraNear, cameraFar, readDepth(uv),
 *   getViewZ(depth).
 * `readDepth` only returns real data because the effect declares
 * EffectAttribute.DEPTH, which makes the EffectPass request the composer's
 * depth texture.
 */
export const mainImageShader = /*glsl*/ `
    uniform sampler2D pFrame;      // previous output of this effect (the P-frame chain)
    uniform sampler2D uVelocity;   // screen space velocity: .xy = uv/frame, .a = coverage
    uniform vec2 uHistoryResolution; // real size of pFrame/uVelocity, which the
                                     // resolution scale can shrink below the pass

    uniform float uTime;           // performance.now(), milliseconds (lost-region clock only)
    uniform float uRecover;        // 0 = fully moshed, 1 = clean; computed on the CPU
    uniform float uKeyframe;       // 1.0 on the frames a fresh keyframe is decoded

    // Camera reprojection: the three matrices needed to ask "where was the point
    // I am looking at one frame ago".
    uniform mat4  uInvViewProjection;      // current view projection, inverted
    uniform mat4  uPrevViewProjection;     // previous frame, full transform
    uniform mat4  uPrevViewProjectionRot;  // previous orientation, current position
    uniform float uMotionSource;   // 1.0 = velocity buffer, 0.0 = camera reprojection
    uniform float uMotionGain;     // artistic exaggeration of the reprojection
    uniform float uParallax;       // weight of the depth dependent (translation) term

    // Macroblocks.
    uniform float uBlockSize;      // macroblock edge, in pixels
    uniform float uBlockiness;     // 0 = continuous per pixel warp, 1 = fully quantised blocks
    uniform float uFrozenBlocks;   // share of coded blocks that lose their motion vector
    uniform float uLostLayers;     // how many grids of lost regions overlap, 1 to 4
    uniform float uMvPrecision;    // sub pixel steps per pixel: 1 = full pel, 2 = half pel
    uniform float uSkipThreshold;  // motion, in pixels, below which a block is not coded at all
    uniform float uMismatch;       // share of blocks that pick up a neighbour's vector

    // Residual.
    uniform float uResidualGain;   // how much of the incoming picture bleeds through
    uniform float uResidualQuant;  // quantisation steps; low = coarse, only strong edges survive

    uniform float uLostLife;       // how long a lost-vector region lasts, in ms
    uniform float uLostScale;      // region size: bigger value, fewer and larger
    uniform float uLostAspect;     // >1 wide rectangles, <1 tall ones
    uniform float uLostVariance;   // 0 = all the same size, 1 = wildly different

    // Debug.
    uniform float uDebugMotion;    // 1 = draw the motion field instead of the picture
    uniform float uDebugScale;     // pixels per frame that map to full brightness

    // --- hashes (Dave Hoskins style: no sin, cheap, well distributed) ------
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

    /**
     * Screen space motion of the surface visible at \`sampleUV\`, in uv units per
     * frame, derived from the camera transform alone.
     *
     * The point is unprojected to world space with the depth buffer and then
     * projected again with the camera of the previous frame. That is an exact
     * reprojection, valid for any movement including roll, rather than the small
     * angle approximation of a linearised yaw/pitch/dolly model.
     *
     * It is projected twice: once with the full previous transform, once with
     * the previous orientation but the *current* position. The difference
     * between the two results is exactly the parallax, i.e. the part of the
     * movement that depends on distance, so uParallax weights that term alone
     * (and, past 1, exaggerates it).
     *
     * This only knows about the camera. Objects that move on their own are
     * static to it, which is why the velocity buffer is the default source.
     */
    vec2 cameraMotionAt(const in vec2 sampleUV) {
        float depth = readDepth(sampleUV);

        vec4 ndc = vec4(vec3(sampleUV, depth) * 2.0 - 1.0, 1.0);
        vec4 world = uInvViewProjection * ndc;
        world /= world.w;

        vec4 prevFull = uPrevViewProjection * world;
        vec4 prevRot = uPrevViewProjectionRot * world;

        // A point that was behind the previous camera plane projects to garbage.
        if (prevFull.w <= 0.0 || prevRot.w <= 0.0) {
            return vec2(0.0);
        }

        vec2 uvFull = (prevFull.xy / prevFull.w) * 0.5 + 0.5;
        vec2 uvRot = (prevRot.xy / prevRot.w) * 0.5 + 0.5;

        return sampleUV - mix(uvRot, uvFull, uParallax);
    }

    /**
     * Whether this point sits inside a region whose motion vectors were lost.
     *
     * Not a per block coin flip, which is what it used to be: a fixed hash on
     * the block id picks the same blocks for the whole gesture, so each one
     * sits still from beginning to end and paints a long streak behind it.
     * Packet loss does not work like that - it takes out whatever run of
     * macroblocks a packet happened to carry, for as long as it takes the next
     * one to arrive, and then it is somewhere else entirely.
     *
     * So: three layers of cells, each placing a rectangle of random size at a
     * random offset inside its cell, on its own phase-shifted clock. The layers
     * overlap freely, which is what produces the irregular compound shapes, and
     * a region only lives a fraction of uLostLife, so it is gone before it has
     * time to leave much of a trail.
     */
    float lostRegion(const in vec2 uv) {
        if (uFrozenBlocks <= 0.0) return 0.0;

        // Constant bound with a break rather than a variable one: the loop has
        // to be unrollable, and the count is a uniform.
        for (int i = 0; i < 4; i++) {
            float fi = float(i);
            if (fi >= uLostLayers) break;

            vec2 cells = vec2(7.0, 5.0) * (1.0 + fi * 1.6) / max(uLostScale, 0.05);
            vec2 cellId = floor(uv * cells);
            vec2 inCell = fract(uv * cells);

            float phase = hash13(vec3(cellId, fi + 5.0));
            float t = uTime / max(uLostLife, 16.0) + phase;
            float slot = floor(t);
            float age = fract(t);

            if (hash13(vec3(cellId, slot * 7.0 + fi)) > uFrozenBlocks) continue;

            vec2 centre = 0.2 + hash23(vec3(cellId, slot + fi * 23.0)) * 0.6;

            // Size is a floor plus a random span, and the span is what the
            // variance scales: at zero every region is the same small
            // rectangle, at one they range from slivers to most of a cell.
            // The aspect term stretches one axis against the other, so the
            // proportions can be pushed from tall to wide without touching area.
            vec2 stretch = vec2(uLostAspect, 1.0 / max(uLostAspect, 0.05));
            vec2 halfSize = (0.05 + hash23(vec3(cellId, slot + fi * 41.0))
                             * vec2(0.45, 0.26) * uLostVariance) * stretch;

            vec2 d = abs(inCell - centre);
            if (d.x > halfSize.x || d.y > halfSize.y) continue;

            // Short duty cycle: most regions blink out well before their slot
            // ends, which is what keeps the streaks short.
            if (age > 0.12 + hash13(vec3(cellId, slot + 61.0)) * 0.45) continue;

            return 1.0;
        }

        return 0.0;
    }

    /**
     * Catmull-Rom lookup into the prediction chain.
     *
     * This is not a quality nicety, it is what stops the picture from
     * dissolving while the trigger is held. The chain re-reads its own previous
     * output every frame, and the motion vectors are snapped to half a pixel -
     * so the offset is *guaranteed* to be fractional, and a fractional bilinear
     * fetch blends two texels. Sixty of those a second compound into a blur
     * that has nothing to do with the effect: the frame visibly loses
     * resolution even when nothing is moving.
     *
     * Catmull-Rom reconstructs with a negative lobe, so repeated resampling
     * keeps its edges instead of averaging them away. It is the same fix a
     * temporal anti-aliasing history buffer needs, for exactly the same reason.
     * Nine bilinear lookups arranged as a separable 4x4 kernel.
     */
    vec3 sampleHistory(const in vec2 uv) {
        vec2 texel = uHistoryResolution;
        vec2 samplePos = uv * texel;
        vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
        vec2 f = samplePos - texPos1;

        vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
        vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
        vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
        vec2 w3 = f * f * (-0.5 + 0.5 * f);

        // The middle two taps are folded into one bilinear fetch placed between
        // them, which is what brings sixteen samples down to nine.
        vec2 w12 = w1 + w2;
        vec2 offset12 = w2 / max(w12, vec2(1e-5));

        vec2 p0 = (texPos1 - 1.0) / texel;
        vec2 p3 = (texPos1 + 2.0) / texel;
        vec2 p12 = (texPos1 + offset12) / texel;

        vec3 result = vec3(0.0);
        result += texture2D(pFrame, vec2(p0.x, p0.y)).rgb * (w0.x * w0.y);
        result += texture2D(pFrame, vec2(p12.x, p0.y)).rgb * (w12.x * w0.y);
        result += texture2D(pFrame, vec2(p3.x, p0.y)).rgb * (w3.x * w0.y);

        result += texture2D(pFrame, vec2(p0.x, p12.y)).rgb * (w0.x * w12.y);
        result += texture2D(pFrame, vec2(p12.x, p12.y)).rgb * (w12.x * w12.y);
        result += texture2D(pFrame, vec2(p3.x, p12.y)).rgb * (w3.x * w12.y);

        result += texture2D(pFrame, vec2(p0.x, p3.y)).rgb * (w0.x * w3.y);
        result += texture2D(pFrame, vec2(p12.x, p3.y)).rgb * (w12.x * w3.y);
        result += texture2D(pFrame, vec2(p3.x, p3.y)).rgb * (w3.x * w3.y);

        // The negative lobe can overshoot, and an overshoot fed back into
        // itself diverges. Clamping here costs nothing and bounds the loop.
        return clamp(result, 0.0, 1.0);
    }

    /**
     * Stand-in for the quantised DCT residual of the incoming picture.
     *
     * Besides the motion vectors, a P-frame carries the correction the
     * prediction cannot supply: the high frequencies of the new frame, coded in
     * 8x8 tiles. Applied against the wrong reference that correction becomes an
     * injection of edges and texture belonging to a scene that is not on screen
     * - which is where the ghosts of a real mosh come from. And since it is
     * summed again on every frame of the feedback chain, it is also what drives a
     * held gesture towards white instead of merely deforming it.
     *
     * A box low pass of the input buffer approximates the frequencies the
     * prediction would have captured; what is left over is the residual. The
     * quantiser has a dead zone, so flat areas transmit nothing at all.
     */
    vec3 residualAt(const in vec2 uv, const in vec2 motion,
                    const in vec3 current, const in vec3 predicted) {
        // Only the *high frequencies* of the incoming picture are transmitted
        // on top of the stale one, and only the part of them the prediction
        // does not already carry.
        //
        // Both halves of that matter, and getting either wrong breaks the
        // effect in an obvious way:
        //
        // Taking a plain high pass of the incoming frame, as this did first,
        // never settles - the same contour is handed to the loop on every frame
        // and integrates until the edges clip, however low the gain.
        //
        // Taking the full prediction error, as it did next, is worse: that is
        // precisely the correction that lands the decoder back on the true
        // frame, so the picture converges on the clean render and the stale
        // texture the whole effect exists to smear simply disappears. A real
        // encoder computes its residual against the *correct* reference, which
        // is why feeding it a wrong one produces ghosts rather than a fix.
        //
        // Subtracting the two high passes keeps the low frequencies of the old
        // shot - its colour, its masses, the thing being dragged - and lays the
        // edges of the new one over them. It is self-limiting, because once
        // those edges are present the term goes to zero.
        // Tight on purpose. The high pass keeps everything finer than this
        // radius, so a wide one lets whole mid-scale structures through - and
        // those carry colour, not just edges. At half a macroblock the new shot
        // bled its palette into the old one and the held frame looked
        // semi-transparent. A pixel and a half keeps the contours and leaves
        // the colour where it belongs, on the picture being dragged.
        vec2 r = vec2(1.5) / resolution;

        vec3 lowCurrent = texture2D(inputBuffer, uv + vec2(r.x, 0.0)).rgb;
        lowCurrent += texture2D(inputBuffer, uv - vec2(r.x, 0.0)).rgb;
        lowCurrent += texture2D(inputBuffer, uv + vec2(0.0, r.y)).rgb;
        lowCurrent += texture2D(inputBuffer, uv - vec2(0.0, r.y)).rgb;

        // Same 1.5-texel ring, but in the history's own texels.
        vec2 rh = vec2(1.5) / uHistoryResolution;

        vec2 p = uv - motion;
        vec3 lowPredicted = texture2D(pFrame, clamp(p + vec2(rh.x, 0.0), 0.002, 0.998)).rgb;
        lowPredicted += texture2D(pFrame, clamp(p - vec2(rh.x, 0.0), 0.002, 0.998)).rgb;
        lowPredicted += texture2D(pFrame, clamp(p + vec2(0.0, rh.y), 0.002, 0.998)).rgb;
        lowPredicted += texture2D(pFrame, clamp(p - vec2(0.0, rh.y), 0.002, 0.998)).rgb;

        // Both high passes, as luminance.
        float hc = dot(current - lowCurrent * 0.25, vec3(0.299, 0.587, 0.114));
        float hp = dot(predicted - lowPredicted * 0.25, vec3(0.299, 0.587, 0.114));

        // Only where the incoming frame has *more* local contrast than the
        // prediction. Taking the plain difference looked right on paper, but it
        // expands to predicted*(1-g) + blur(predicted)*g + g*hc, and that first
        // half is an inverted unsharp mask: a blur, re-applied every frame.
        // Wherever the new shot was flat it was the only term left, so the held
        // picture was quietly smoothed into mush at sixty frames a second.
        // Gating on magnitude adds the new edges without ever eroding the old
        // ones - and it still cannot accumulate, because once the two agree the
        // term is zero.
        float residual = abs(hc) > abs(hp) ? hc - hp : 0.0;

        // Dead zone quantiser, as in a real encoder: below one step there is no
        // coefficient worth sending, so flat areas transmit nothing at all.
        // Luma only - a codec quantises chroma far more coarsely, and an RGB
        // residual would deposit the new shot's palette on the old picture.
        float steps = max(uResidualQuant, 1.0);
        return vec3(floor(residual * steps + 0.5) / steps);
    }

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        // Recovery cross fade: 0 = fully moshed, 1 = clean input.
        float recover = uRecover;

        // Nothing to do once the picture has recovered: skip the whole warp.
        // The debug view is exempt - the point of it is to see the field while
        // the gesture is *not* running.
        if (recover >= 1.0 && uDebugMotion < 0.5) {
            outputColor = inputColor;
            return;
        }

        // A keyframe resets the decoder: it carries a full picture, so the
        // prediction chain is dropped and this clean frame becomes the new
        // reference the next P-frames will drift away from.
        if (uKeyframe > 0.5) {
            outputColor = inputColor;
            return;
        }

        // The recovery is a gate on the *prediction*, not only a mix on the
        // output colour. Letting the blocks keep sliding at full speed while the
        // picture dissolves means the feedback chain drags fresh garbage in
        // during the very frames that are supposed to be converging; scaling the
        // motion and the residual down with the fade makes the smear decelerate
        // and come to rest, so the image can only ever get closer to the clean
        // frame.
        float warp = uDebugMotion > 0.5 ? 1.0 : 1.0 - recover;

        // --- macroblock grid ----------------------------------------------
        vec2 blocks = max(resolution / max(uBlockSize, 1.0), vec2(1.0));
        vec2 blockId = floor(uv * blocks);
        vec2 blockUV = (blockId + 0.5) / blocks;

        // Motion compensation mismatch: block matching minimises a numeric
        // difference, not a semantic one, so it regularly locks onto a block
        // that belongs to a different object. Reading the vector one block away
        // reproduces that - the tile slides with a movement that is not its
        // own, which is the "blocks lifted from somewhere else" look.
        float mismatch = step(hash13(vec3(blockId, 23.0)), uMismatch) * uBlockiness;
        vec2 neighbour = sign(hash23(vec3(blockId, 29.0)) - 0.5) / blocks;
        vec2 mvBlockUV = clamp(blockUV + neighbour * mismatch, vec2(0.0), vec2(1.0));

        // The motion vector is evaluated at the block centre; uBlockiness fades
        // back to a per pixel evaluation, i.e. the old continuous smear.
        vec2 mvUV = mix(uv, mvBlockUV, uBlockiness);

        // --- motion vector -------------------------------------------------
        // Measured field: already per frame, and already containing the camera
        // contribution. The analytic one is an alternative, never a summand -
        // adding them would count the camera twice. Where the velocity pass
        // rasterised nothing (.a == 0) there is no measurement, so the camera
        // reprojection takes over.
        vec4 measured = texture2D(uVelocity, mvUV);
        float useMeasured = uMotionSource * step(0.5, measured.a);

        vec2 motion = mix(cameraMotionAt(mvUV), measured.xy, useMeasured)
                    * uMotionGain * warp;

        // Real motion vectors are not continuous: MPEG-4 Part 2 stores them at
        // half pixel precision, H.264 at quarter pixel. Snapping to that grid is
        // what makes neighbouring blocks slide by visibly different amounts
        // instead of forming a smooth field.
        float mvSteps = max(uMvPrecision, 1.0);
        vec2 motionPx = motion * resolution;
        motion = mix(motionPx, floor(motionPx * mvSteps + 0.5) / mvSteps, uBlockiness)
               / resolution;

        // --- skipped and lost blocks ---------------------------------------
        float motionPixels = length(motion * resolution);

        // Skipped macroblocks are not coded at all: below the threshold the
        // encoder sends neither a vector nor a residual, and the decoder just
        // keeps whatever the reference held. Static areas therefore stay frozen
        // while moving ones smear, and the contrast between those two
        // populations of blocks is the visual signature of a datamosh - the
        // mechanism behind its ghosting.
        // Guarded: at a threshold of zero the smoothstep would have equal edges,
        // which is undefined in GLSL and in practice returns 1 on some drivers -
        // freezing the entire frame instead of nothing.
        float skip = uSkipThreshold <= 0.0
            ? 0.0
            : (1.0 - smoothstep(uSkipThreshold * 0.5, uSkipThreshold, motionPixels))
              * uBlockiness;

        // Lost vectors are a different failure: the block *is* coded, it simply
        // does not move. It still receives its residual.
        float lost = lostRegion(blockUV) * uBlockiness;

        motion *= 1.0 - max(skip, lost);

        // --- debug view -----------------------------------------------------
        // Drawn from the vector the effect is actually about to use, after the
        // block quantisation, the sub pixel snap, the skip and the mismatch -
        // not from the raw velocity buffer. Seeing the raw field would hide
        // exactly the stages that decide what the picture does.
        //
        // Hue is direction, brightness is magnitude, and the grid marks the
        // macroblocks. Grey means a block that is not moving: at full recovery
        // that is most of the frame, which is the point - those are the skipped
        // blocks that will freeze and produce the ghosting.
        if (uDebugMotion > 0.5) {
            float magnitude = length(motion * resolution);
            float angle = atan(motion.y, motion.x);

            // Direction around the wheel, magnitude as value.
            vec3 wheel = clamp(
                abs(mod(angle / 6.2831853 * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
                0.0, 1.0
            );
            float value = clamp(magnitude / max(uDebugScale, 0.01), 0.0, 1.0);
            vec3 debug = mix(vec3(0.12), wheel, step(0.02, value)) * max(value, 0.12);

            // Macroblock grid, so the quantisation is visible as such.
            vec2 grid = abs(fract(uv * blocks) - 0.5);
            float line = 1.0 - step(0.47, max(grid.x, grid.y));
            debug = mix(vec3(0.35), debug, line);

            outputColor = vec4(debug, 1.0);
            return;
        }

        // The whole block is sampled with the same offset, added to the pixel's
        // own uv, so the tile slides as a unit instead of getting pixelated.
        // A block that ended up with no motion at all reads its own texel
        // exactly, which is both cheaper and lossless - worth the branch
        // because with a still camera that is most of the frame.
        vec3 moshed = length(motion * resolution) < 0.001
            ? texture2D(pFrame, uv).rgb
            : sampleHistory(uv - motion);

        // The residual belongs to the incoming picture and is applied to the
        // stale one, exactly like a decoder handed the wrong reference would.
        moshed += residualAt(uv, motion, inputColor.rgb, moshed) * uResidualGain * (1.0 - skip) * warp;

        // Clipping is not a safety net here, it is part of the effect: the
        // residual keeps being re-added on every frame of the chain, so a held
        // gesture drifts monotonically into saturation.
        moshed = clamp(moshed, 0.0, 1.0);

        outputColor = vec4(mix(moshed, inputColor.rgb, recover), 1.0);
    }
`;
