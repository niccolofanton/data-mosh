/**
 * The whole effect is this one fragment shader. It runs the loop a video
 * decoder runs on every P-frame:
 *
 *   new frame = warp(previous frame, motion vectors) + residual
 *
 * A real datamosh happens when the decoder keeps running that loop but never
 * receives a fresh keyframe: the motion is right, the picture underneath is
 * wrong, and the two drift apart. Here `pFrame` is the previous frame fed back
 * from the composer, and `uRecover` is how much of the honest render bleeds
 * back in once the gesture ends.
 */
export const mainImageShader = /*glsl*/ `
    // pFrame is the feedback buffer (the decoder's reference frame), uVelocity
    // the per-pixel motion rendered by VelocityPass. uKeyframe forces a clean
    // frame through, uRecover fades the damage away.
    uniform sampler2D pFrame; uniform sampler2D uVelocity;
    uniform float uTime; uniform float uRecover; uniform float uKeyframe;

    // The real size of pFrame (and the velocity buffer). With the resolution
    // scale below 1 they are smaller than the pass, and every read that
    // positions itself in *their* texels has to use this, not \`resolution\`.
    uniform vec2 uHistoryResolution;

    // Camera motion, for the pixels the velocity buffer knows nothing about:
    // unproject through the depth buffer, reproject through the previous
    // camera. uParallax mixes between the full previous matrix (translation
    // included) and rotation only.
    uniform mat4 uInvViewProjection; uniform mat4 uPrevViewProjection; uniform mat4 uPrevViewProjectionRot;
    uniform float uMotionGain; uniform float uParallax;

    // Macroblock behaviour. uBlockiness is the master dial: at 0 everything
    // below degrades to a smooth per-pixel warp, at 1 it is tiles all the way.
    uniform float uBlockSize; uniform float uBlockiness; uniform float uMvPrecision;
    uniform float uSkipThreshold; uniform float uMismatch;
    uniform float uFrozenBlocks; uniform float uLostLayers; uniform float uLostLife;
    uniform float uLostScale; uniform float uLostAspect; uniform float uLostVariance;

    uniform float uResidualGain; uniform float uResidualQuant;
    uniform float uDebugMotion; uniform float uDebugScale; uniform float uShowLostSectors;
    uniform float uDebugField; uniform float uDebugArrows; uniform float uShowMotionArrows;

    // Hashes keyed on (block id, slot): every block decides its own fate
    // without any per-block state to store.
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

    // Motion for pixels the velocity buffer says nothing about. Walk the pixel
    // back to world space through the depth buffer, then forward through the
    // previous camera: the gap between the two screen positions is the vector.
    vec2 cameraMotionAt(const in vec2 sampleUV) {
        vec4 world = uInvViewProjection * vec4(vec3(sampleUV, readDepth(sampleUV)) * 2.0 - 1.0, 1.0);
        world /= world.w;

        vec4 prevFull = uPrevViewProjection * world;
        vec4 prevRot = uPrevViewProjectionRot * world;
        if (prevFull.w <= 0.0 || prevRot.w <= 0.0) return vec2(0.0);

        return sampleUV - mix((prevRot.xy / prevRot.w) * 0.5 + 0.5,
                              (prevFull.xy / prevFull.w) * 0.5 + 0.5, uParallax);
    }

    // Packet loss. Rectangles on a few overlapping grids blink in and out on
    // their own clocks; a pixel inside one keeps its old content instead of
    // being warped, which is what a decoder does with a block it never got.
    // Returns (inside the sector, on its border) — the border is what the
    // overlay draws, and costs nothing extra to find on the way.
    vec2 lostRegion(const in vec2 uv) {
        if (uFrozenBlocks <= 0.0) return vec2(0.0);

        for (float fi = 0.0; fi < 4.0; fi++) {
            if (fi >= uLostLayers) break;

            vec2 scale = vec2(7.0, 5.0) * (1.0 + fi * 1.6) / max(uLostScale, 0.05);
            vec2 p = uv * scale;
            vec2 cellId = floor(p);

            // Each cell holds one rectangle per time slot, and only for the
            // first fraction of that slot: that is the blink.
            float t = uTime / max(uLostLife, 16.0) + hash13(vec3(cellId, fi + 5.0));
            float slot = floor(t);
            if (hash13(vec3(cellId, slot * 7.0 + fi)) > uFrozenBlocks) continue;

            vec2 centre = 0.2 + hash23(vec3(cellId, slot + fi * 23.0)) * 0.6;
            vec2 halfSize = (0.05 + hash23(vec3(cellId, slot + fi * 41.0)) * vec2(0.45, 0.26) * uLostVariance)
                            * vec2(uLostAspect, 1.0 / max(uLostAspect, 0.05));

            vec2 d = abs(fract(p) - centre) - halfSize;
            if (any(greaterThan(d, vec2(0.0)))) continue;
            if (fract(t) > 0.12 + hash13(vec3(cellId, slot + 61.0)) * 0.45) continue;

            // Inside a box the signed distance to its edge is exactly
            // max(d.x, d.y); converted to pixels, one macroblock of it is the
            // ring of blocks that actually froze along the boundary.
            vec2 edge = d / scale * resolution;
            return vec2(1.0, step(-max(uBlockSize, 2.0), max(edge.x, edge.y)));
        }

        return vec2(0.0);
    }

    // Measured motion where the velocity buffer covered geometry, camera motion
    // everywhere else (background, sky, anything not rendered into it).
    vec2 rawMotionAt(const in vec2 sampleUV) {
        vec4 measured = texture2D(uVelocity, sampleUV);
        return mix(cameraMotionAt(sampleUV), measured.xy, step(0.5, measured.a));
    }

    // Catmull-Rom read of the previous frame, 9 taps instead of 16 by riding
    // the hardware bilinear filter. Motion vectors land between texels and the
    // result is fed back in as the next reference frame, so a plain bilinear
    // read would melt the picture into mush after a few dozen frames.
    vec3 sampleHistory(const in vec2 uv) {
        vec2 samplePos = uv * uHistoryResolution;
        vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
        vec2 f = samplePos - texPos1;

        vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
        vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
        vec2 w3 = f * f * (-0.5 + 0.5 * f);
        vec2 w12 = 1.0 + f * f * (-2.5 + 1.5 * f) + w2;
        vec2 offset12 = w2 / max(w12, vec2(1e-5));

        // The middle tap of each axis sits off-centre so one bilinear fetch
        // covers the two inner samples at once.
        vec3 px = (texPos1.x + vec3(-1.0, offset12.x, 2.0)) / uHistoryResolution.x;
        vec3 py = (texPos1.y + vec3(-1.0, offset12.y, 2.0)) / uHistoryResolution.y;
        vec3 wx = vec3(w0.x, w12.x, w3.x);
        vec3 wy = vec3(w0.y, w12.y, w3.y);

        vec3 result = vec3(0.0);
        for (int y = 0; y < 3; y++) {
            for (int x = 0; x < 3; x++) {
                result += texture2D(pFrame, vec2(px[x], py[y])).rgb * (wx[x] * wy[y]);
            }
        }

        return clamp(result, 0.0, 1.0);
    }

    // The correction a real stream carries next to the vectors. Compare the
    // high frequencies of the honest render against those of the prediction,
    // keep the difference only where the render is sharper, and quantise it
    // hard: that ringing along the edges is the DCT dead zone showing.
    vec3 residualAt(const in vec2 uv, const in vec2 motion, const in vec3 current, const in vec3 predicted) {
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

        float hc = dot(current - lowCurrent * 0.25, vec3(0.299, 0.587, 0.114));
        float hp = dot(predicted - lowPredicted * 0.25, vec3(0.299, 0.587, 0.114));
        float steps = max(uResidualQuant, 1.0);

        return vec3(floor((abs(hc) > abs(hp) ? hc - hp : 0.0) * steps + 0.5) / steps);
    }

    // A motion vector drawn the way a codec debugger draws it: three strokes,
    // the shaft and two barbs folded back from the tip. p is in the cell's own
    // frame, x running along the motion.
    float sdSegment(const in vec2 p, const in vec2 a, const in vec2 b) {
        vec2 pa = p - a, ba = b - a;
        return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
    }

    float sdArrow(const in vec2 p, const in float len) {
        vec2 tip = vec2(len, 0.0);
        vec2 barb = vec2(0.42, 0.42) * len;
        return min(sdSegment(p, vec2(-len, 0.0), tip),
                   min(sdSegment(p, tip, tip - barb), sdSegment(p, tip, tip - barb * vec2(1.0, -1.0))));
    }

    // Coverage of the cell's arrow at this pixel. Arrows sit on the block grid,
    // but thinned to whole blocks until a cell is around 48px: at the default
    // 8px macroblock an arrow per block is a smudge. The vector is read at the
    // cell centre, which is where a codec stores it.
    float arrowAt(const in vec2 uv, const in vec2 blocks, const in vec2 blockId) {
        float span = max(floor(48.0 / max(uBlockSize, 1.0) + 0.5), 1.0);
        vec2 cellId = floor(blockId / span) * span;
        vec2 cellMotion = rawMotionAt((cellId + span * 0.5) / blocks) * uMotionGain * resolution;

        float speed = length(cellMotion);
        float reach = clamp(speed / max(uDebugScale, 0.01), 0.0, 1.0);
        vec2 dir = speed > 1e-4 ? cellMotion / speed : vec2(1.0, 0.0);

        // Into the cell's own frame: x along the motion, y across it.
        vec2 local = ((uv * blocks - cellId) / span - 0.5) * 2.0;
        local = vec2(dot(local, dir), dot(local, vec2(-dir.y, dir.x)));

        // One pixel in those units, so the stroke stays one pixel wide whatever
        // the macroblock is set to.
        float px = 2.0 * blocks.x / (span * resolution.x);
        return (1.0 - smoothstep(-px, px, sdArrow(local, 0.15 + reach * 0.7) - px)) * step(0.02, reach);
    }

    // The arrows drawn over a picture we do not control the palette of, so the
    // ink is the plain negative of whatever is underneath.
    vec3 withArrows(const in vec3 colour, const in float coverage) {
        return mix(colour, 1.0 - colour, coverage);
    }

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec2 blocks = max(resolution / max(uBlockSize, 1.0), vec2(1.0));
        vec2 blockId = floor(uv * blocks);
        vec2 blockUV = (blockId + 0.5) / blocks;

        // Nothing to decode: either the effect is at rest, or this is the
        // keyframe that repairs the picture. The two overlays still draw here —
        // reading the field without holding the trigger is the point of them.
        if ((uRecover >= 1.0 && uDebugMotion < 0.5) || uKeyframe > 0.5) {
            vec3 clean = inputColor.rgb;
            if (uShowMotionArrows > 0.5) clean = withArrows(clean, arrowAt(uv, blocks, blockId));

            float border = lostRegion(blockUV).y * uShowLostSectors * uBlockiness;
            outputColor = vec4(mix(clean, vec3(1.0), border), inputColor.a);
            return;
        }

        float warp = uDebugMotion > 0.5 ? 1.0 : 1.0 - uRecover;

        // One vector per macroblock, read at the block centre. A few blocks
        // read their neighbour's vector instead: motion compensation mismatch,
        // the tell of a corrupted vector table.
        vec2 mvBlockUV = clamp(blockUV + (sign(hash23(vec3(blockId, 29.0)) - 0.5) / blocks)
                                         * (step(hash13(vec3(blockId, 23.0)), uMismatch) * uBlockiness), 0.0, 1.0);
        vec2 mvUV = mix(uv, mvBlockUV, uBlockiness);

        vec2 motion = rawMotionAt(mvUV) * uMotionGain * warp;

        // Codecs store vectors at half or quarter pixel, never at float
        // precision. Snapping to that grid is what makes the smear step.
        float mvSteps = max(uMvPrecision, 1.0);
        vec2 motionPx = motion * resolution;
        motion = mix(motionPx, floor(motionPx * mvSteps + 0.5) / mvSteps, uBlockiness) / resolution;

        // Two ways a block ends up frozen: too little motion to be worth
        // coding (skip), or its data never arrived (lost).
        float skip = uSkipThreshold <= 0.0 ? 0.0
            : (1.0 - smoothstep(uSkipThreshold * 0.5, uSkipThreshold, length(motion * resolution))) * uBlockiness;

        // Debug view: the field as hue and brightness, over the macroblock grid
        // the vectors are quantised to, with an arrow per cell on top. Lost
        // sectors are left out of it — this view exists to read the vector
        // field, and punching holes in it only hides the thing being read.
        if (uDebugMotion > 0.5) {
            vec2 shown = motion * (1.0 - skip);

            vec3 wheel = clamp(abs(mod(atan(shown.y, shown.x) / 6.2831853 * 6.0
                                       + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
            float value = clamp(length(shown * resolution) / max(uDebugScale, 0.01), 0.0, 1.0);
            vec3 field = mix(vec3(0.12), wheel, step(0.02, value)) * max(value, 0.12);

            // With the field off the arrows are left on bare black, which is
            // where their direction is easiest to read.
            vec3 debug = mix(vec3(0.0), field, uDebugField);

            vec2 grid = abs(fract(uv * blocks) - 0.5);
            debug = mix(vec3(0.35), debug, 1.0 - step(0.47, max(grid.x, grid.y)));

            // Gated on the motion this view shows, so a skipped block draws no
            // arrow: the decoder moves nothing there.
            float arrow = arrowAt(uv, blocks, blockId) * step(1e-6, length(shown)) * uDebugArrows;

            float border = lostRegion(blockUV).y * uShowLostSectors * uBlockiness;
            outputColor = vec4(mix(withArrows(debug, arrow), vec3(1.0), border), 1.0);
            return;
        }

        vec2 lost = lostRegion(blockUV);
        motion *= 1.0 - max(skip, lost.x * uBlockiness);

        // The decode itself: drag the previous frame along the vectors, add the
        // residual, then let the honest render fade back in as uRecover rises.
        vec3 moshed = length(motion * resolution) < 0.001
            ? texture2D(pFrame, uv).rgb
            : sampleHistory(uv - motion);

        moshed += residualAt(uv, motion, inputColor.rgb, moshed) * uResidualGain * (1.0 - skip) * warp;

        vec3 decoded = mix(clamp(moshed, 0.0, 1.0), inputColor.rgb, uRecover);
        if (uShowMotionArrows > 0.5) decoded = withArrows(decoded, arrowAt(uv, blocks, blockId));

        outputColor = vec4(mix(decoded, vec3(1.0), lost.y * uShowLostSectors * uBlockiness), 1.0);
    }
`;

/**
 * The velocity buffer: where every pixel of the scene was on the previous
 * frame, in screen space. Rendered as an override material over the whole
 * scene, so it costs one extra depth-only style pass.
 *
 * Both clip positions travel to the fragment stage because the perspective
 * divide has to happen per pixel, not per vertex.
 */
export const velocityVertexShader = /*glsl*/ `
  uniform mat4 uPreviousModelMatrix; uniform mat4 uPreviousViewProjection; uniform float uHasPrevious;
  varying vec4 vClipCurrent, vClipPrevious;

  void main() {
    vClipCurrent = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vClipPrevious = mix(vClipCurrent,
      uPreviousViewProjection * uPreviousModelMatrix * vec4(position, 1.0), uHasPrevious);

    gl_Position = vClipCurrent;
  }
`;

/**
 * Alpha 1 marks "this pixel has real geometry behind it" — the effect uses it
 * to decide between measured motion and the camera fallback. The clamp keeps a
 * vertex crossing the near plane from writing an absurd vector.
 */
export const velocityFragmentShader = /*glsl*/ `
  varying vec4 vClipCurrent, vClipPrevious;

  void main() {
    vec2 velocity = vClipPrevious.w <= 0.0 ? vec2(0.0)
      : (vClipCurrent.xy / vClipCurrent.w - vClipPrevious.xy / vClipPrevious.w) * 0.5;

    gl_FragColor = vec4(clamp(velocity, -0.25, 0.25), 0.0, 1.0);
  }
`;
