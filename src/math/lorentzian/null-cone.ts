import { Matrix } from "../linalg/index.ts";
import type { SpaceView } from "../spaces/index.ts";
import type { LorentzianManifold } from "./lorentzian-manifold.ts";

export interface NullConeOptions {
  // Normalization: E = −p_{timeIndex}. Fixes the affine parameter's scale
  // (plan §4.2); default 1.
  energy?: number;
}

// The future null directions at an event, sampled by spatial emission angle θ.
export interface NullCone<V extends SpaceView> {
  readonly energy: number;
  // Write the null covector p_μ for emission angle θ into `out`.
  momentumInto(out: V, theta: number): void;
  // Allocate and return the null covector for emission angle θ.
  momentum(theta: number): V;
}

// The infinitesimal null cone at `event` (plan §4.2): future-directed null
// covectors g^{μν} p_μ p_ν = 0, one per spatial emission angle θ.
//
// We fix the time component p_t = −E and let the spatial covector be
// ρ·(cos θ, sin θ) on the two non-time axes, then solve the null condition
// for the magnitude ρ. Writing p = f + ρ w with f the fixed time part and w
// the unit spatial direction, g^{μν}p_μp_ν = G(w,w) ρ² + 2 G(f,w) ρ + G(f,f),
// a plain quadratic — so this is honest for a general (even non-diagonal)
// metric, not just the diagonal isotropic case. We take the ρ > 0 (outgoing)
// root.
//
// 2+1 only for now: exactly two spatial axes make θ a full parameterization.
export function nullConeAt<V extends SpaceView>(
  M: LorentzianManifold<V>,
  event: V,
  options: NullConeOptions = {},
): NullCone<V> {
  const n = M.dimension;
  if (n !== 3) {
    throw new RangeError(`nullConeAt: 2+1 (dimension 3) only for now, got ${n}`);
  }
  const energy = options.energy ?? 1;
  const t = M.timeIndex;
  const spatial = [0, 1, 2].filter((i) => i !== t);
  const s1 = spatial[0]!;
  const s2 = spatial[1]!;

  // Freeze g^{μν} at the apex — the cone's initial data lives there.
  const G = Matrix.square(n);
  M.metric.gInverseInto(G, event);

  // G(f, f) with f_t = −E: only the (t,t) term survives.
  const Gff = G.get(t, t) * energy * energy;

  const momentumInto = (out: V, theta: number): void => {
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    // G(w, w) and G(f, w), w spatial unit covector (c on s1, s on s2).
    const Gww =
      G.get(s1, s1) * c * c + 2 * G.get(s1, s2) * c * s + G.get(s2, s2) * s * s;
    const Gfw = -energy * (G.get(t, s1) * c + G.get(t, s2) * s);

    const A = Gww;
    const B = 2 * Gfw;
    const C = Gff;
    const disc = B * B - 4 * A * C;
    if (A === 0 || disc < 0) {
      throw new Error(
        `nullConeAt: no real future null direction at θ=${theta} (A=${A}, disc=${disc})`,
      );
    }
    const rho = (-B + Math.sqrt(disc)) / (2 * A);

    const ob = out.buffer;
    const oo = out.offset;
    for (let i = 0; i < n; i += 1) ob[oo + i] = 0;
    ob[oo + t] = -energy;
    ob[oo + s1] = rho * c;
    ob[oo + s2] = rho * s;
  };

  return {
    energy,
    momentumInto,
    momentum: (theta: number): V => {
      const out = M.chart.create();
      momentumInto(out, theta);
      return out;
    },
  };
}
