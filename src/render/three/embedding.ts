// How a spacetime chart point (t, x, y) maps into world ℝ³ for rendering. The
// default puts time on the vertical axis — so a light cone renders as the
// classic upward-flaring cone of a spacetime diagram, warped by the lensing.
// Swap the embedding to reorient (e.g. an (x, t) side view).
export interface SpacetimeEmbedding {
  readonly timeScale: number;
  // Write the world position of (t, x, y) into `out` at `offset` (3 floats).
  embedInto(out: Float32Array, offset: number, t: number, x: number, y: number): void;
}

// Time up: world (X, Y, Z) = (x, t·timeScale, y). `timeScale` stretches or
// compresses the cone vertically relative to the spatial plane.
export function timeUp(timeScale = 1): SpacetimeEmbedding {
  return {
    timeScale,
    embedInto(out, o, t, x, y) {
      out[o] = x;
      out[o + 1] = t * timeScale;
      out[o + 2] = y;
    },
  };
}
