import type { LightCone } from "./light-cone.ts";

// Caustics are where the light-cone's spatial congruence folds — neighboring
// rays focus and cross. Formally, the map (θ, λ) → (x, y) degenerates there,
// so its areal Jacobian
//
//   J = ∂x/∂θ · ∂y/∂λ − ∂x/∂λ · ∂y/∂θ
//
// vanishes and flips sign. (In flat space x = apex + λ·dir, so J = −λ < 0
// everywhere — no zeros, no caustics, exactly right.) We finite-difference J
// across the grid, then extract its zero set by marching squares: the caustic
// curve, the bright cusps of the lensing.
//
// This is the discrete face of geodesic focusing — the separation of nearby
// rays is a Jacobi field, and caustics are its conjugate points (plan §Phase B).

// J at every grid node, NaN where it can't be centrally differenced (the apex
// row, the λ ends, and the torn edge where a neighbor ray terminated early).
export function jacobianField(cone: LightCone): Float64Array {
  const nT = cone.rayCount;
  const nL = cone.sampleCount;
  const dLambda = cone.lambdas[1]! - cone.lambdas[0]!;
  const J = new Float64Array(nT * nL).fill(NaN);
  const rl = cone.rayLengths;

  for (let i = 0; i < nT; i += 1) {
    const ip = (i + 1) % nT;
    const im = (i - 1 + nT) % nT;
    // Forward angular span from ray im to ray ip through ray i (handles wrap).
    const dTheta = forwardSpan(cone.directions[im]!, cone.directions[ip]!);

    for (let j = 1; j < nL - 1; j += 1) {
      // Need ray i valid at j−1, j, j+1 and neighbors valid at j.
      if (rl[i]! <= j + 1 || rl[ip]! <= j || rl[im]! <= j) continue;

      const dxTheta = (cone.coord(ip, j, 1) - cone.coord(im, j, 1)) / dTheta;
      const dyTheta = (cone.coord(ip, j, 2) - cone.coord(im, j, 2)) / dTheta;
      const dxLambda = (cone.coord(i, j + 1, 1) - cone.coord(i, j - 1, 1)) / (2 * dLambda);
      const dyLambda = (cone.coord(i, j + 1, 2) - cone.coord(i, j - 1, 2)) / (2 * dLambda);

      J[i * nL + j] = dxTheta * dyLambda - dxLambda * dyTheta;
    }
  }
  return J;
}

// The caustic curve as packed line segments: 6 floats per segment,
// [t₀, x₀, y₀, t₁, x₁, y₁]. Marching squares of the J = 0 contour over each
// grid cell whose four corners have a defined J.
export function causticSegments(cone: LightCone): Float64Array {
  const nT = cone.rayCount;
  const nL = cone.sampleCount;
  const J = jacobianField(cone);
  const out: number[] = [];

  const point = (i: number, j: number): [number, number, number] => [
    cone.coord(i, j, 0),
    cone.coord(i, j, 1),
    cone.coord(i, j, 2),
  ];

  for (let i = 0; i < nT; i += 1) {
    const ip = (i + 1) % nT;
    for (let j = 1; j < nL - 2; j += 1) {
      const jv = [J[i * nL + j]!, J[ip * nL + j]!, J[ip * nL + j + 1]!, J[i * nL + j + 1]!];
      if (jv.some((v) => Number.isNaN(v))) continue;

      const corners: [number, number, number][] = [
        point(i, j),
        point(ip, j),
        point(ip, j + 1),
        point(i, j + 1),
      ];

      // Zero-crossings on the four edges (0-1, 1-2, 2-3, 3-0).
      const crossings: [number, number, number][] = [];
      for (let e = 0; e < 4; e += 1) {
        const a = e;
        const b = (e + 1) % 4;
        const ja = jv[a]!;
        const jb = jv[b]!;
        if ((ja < 0 && jb >= 0) || (ja >= 0 && jb < 0)) {
          const f = ja / (ja - jb);
          const pa = corners[a]!;
          const pb = corners[b]!;
          crossings.push([
            pa[0] + f * (pb[0] - pa[0]),
            pa[1] + f * (pb[1] - pa[1]),
            pa[2] + f * (pb[2] - pa[2]),
          ]);
        }
      }

      // Two crossings → one segment; four (a saddle) → two, paired simply.
      if (crossings.length === 2) {
        out.push(...crossings[0]!, ...crossings[1]!);
      } else if (crossings.length === 4) {
        out.push(...crossings[0]!, ...crossings[1]!);
        out.push(...crossings[2]!, ...crossings[3]!);
      }
    }
  }
  return Float64Array.from(out);
}

function forwardSpan(from: number, to: number): number {
  const TWO_PI = 2 * Math.PI;
  return ((to - from) % TWO_PI + TWO_PI) % TWO_PI;
}
