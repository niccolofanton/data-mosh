/**
 * The two things every shader that draws the cloth has to agree about: where a
 * vertex reads its position from, and how the surface normal is rebuilt.
 *
 * Shared as a string because three separate programs need it and they must not
 * drift: the material that renders the cloth, and the velocity pass's override
 * material, which draws the same mesh twice - once with this frame's positions
 * and once with the previous frame's. If those two disagreed by so much as a
 * texel offset, the motion field would be measuring the disagreement instead of
 * the movement.
 *
 * Requires `uClothExtent` (the cloth's width and height in world units) and
 * `uClothSize` (particles per side) in scope.
 */
export const clothSampleGlsl = /*glsl*/ `
  /**
   * Texel centre for this vertex.
   *
   * The plane has one vertex per particle spanning the full extent, so a
   * vertex sits at i/(size-1) of the way across - but a texel *centre* sits at
   * (i+0.5)/size. Sampling at the vertex fraction instead would land between
   * texels, and with a nearest-filtered position texture that means whole
   * vertices silently reading their neighbour's position.
   */
  vec2 clothTexel(vec3 localPosition) {
    vec2 grid = localPosition.xy / uClothExtent + 0.5;
    return (grid * (uClothSize - 1.0) + 0.5) / uClothSize;
  }

  vec3 clothPosition(sampler2D positions, vec2 uv) {
    return texture2D(positions, uv).xyz;
  }

  /**
   * Normal from the four neighbouring particles.
   *
   * Rebuilt rather than transformed: the geometry's own normals describe a flat
   * plane and have nothing to do with the shape the solver produced. At the
   * edges the clamped sampler returns the edge texel itself, which makes one of
   * the two spans half-length - the direction stays right, which is all a
   * normalised cross product needs.
   */
  vec3 clothNormal(sampler2D positions, vec2 uv) {
    float t = 1.0 / uClothSize;

    vec3 left  = clothPosition(positions, uv - vec2(t, 0.0));
    vec3 right = clothPosition(positions, uv + vec2(t, 0.0));
    vec3 down  = clothPosition(positions, uv - vec2(0.0, t));
    vec3 up    = clothPosition(positions, uv + vec2(0.0, t));

    vec3 n = cross(right - left, up - down);
    return length(n) > 1e-8 ? normalize(n) : vec3(0.0, 0.0, 1.0);
  }
`;
