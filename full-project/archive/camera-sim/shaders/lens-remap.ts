/**
 * The geometric half of the lens, shared by everything that has to agree about
 * where a pixel is.
 *
 * It lives on its own because two unrelated stages need the *same* mapping and
 * a copy that drifts is worse than no copy at all. The optics pass uses it to
 * draw the picture; the datamosh uses it to look up the scene buffers - the
 * velocity field and the depth - which are rendered through the plain
 * projection and therefore live in a different set of coordinates from the
 * image they are supposed to describe.
 *
 * Without that second use the effect is subtly but visibly wrong. The output
 * pixel at the corner of a barrel-distorted frame is showing scene content from
 * some way inside the frame, while the motion vector read at that same corner
 * belongs to the content that would have been there without the lens. The two
 * disagree most exactly where the distortion is strongest, so the melt drags
 * the edges of the picture in directions nothing on screen is moving in.
 *
 * Requires `aspect` in scope, plus `uBarrel` and `uSkew` uniforms. Both zero is
 * exactly the identity - `(1 + 0) / (1 + 0)` and no shear - so a stage that
 * simply passes zeros needs no branch to switch the lens off.
 */
export const lensRemapGlsl = /*glsl*/ `
    /**
     * Barrel distortion plus the shutter's read order, as one uv remap.
     *
     * The two compose rather than stack: the rows are read at different times
     * *through* the lens, so a pan skews the already-distorted image.
     *
     * The distortion is normalised against the corner so it redistributes the
     * frame instead of shrinking it. Without that the picture pulls away from
     * the edges and leaves a black border, which is the opposite of what a wide
     * lens does - a wide lens fills the frame, it does not float inside it.
     */
    vec2 lensRemap(vec2 uv) {
        vec2 centred = uv - 0.5;
        // Aspect corrected so the distortion stays circular rather than
        // following the shape of the viewport.
        centred.x *= aspect;

        float r2 = dot(centred, centred);
        float cornerR2 = 0.25 * (aspect * aspect + 1.0);
        centred *= (1.0 + uBarrel * r2) / (1.0 + uBarrel * cornerR2);

        centred.x /= aspect;

        // Rolling shutter: the last row is read later than the first, so during
        // a horizontal pan the bottom of the frame lags behind the top and the
        // image leans over.
        centred.x += uSkew * centred.y;

        return centred + 0.5;
    }
`;
