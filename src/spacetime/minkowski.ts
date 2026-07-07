import { LorentzianManifold, metric } from "../math/lorentzian/index.ts";
import { spacetimeChart, TIME_INDEX, type Event } from "./chart.ts";

// Flat 2+1 Minkowski spacetime: g^{μν} = diag(−1, 1, 1), constant. The
// validation instance for the whole engine — null geodesics are straight
// lines traversed at unit coordinate speed, and H and E = −p_t are conserved
// exactly (the metric is constant, so ṗ ≡ 0). If anything downstream bends a
// Minkowski photon, the bug is ours, not the physics.
export function minkowski(): LorentzianManifold<Event> {
  const chart = spacetimeChart("Minkowski(2+1)");
  const g = metric({
    dimension: 3,
    timeIndex: TIME_INDEX,
    gInverseInto: (out) => {
      out.zero();
      out.set(0, 0, -1);
      out.set(1, 1, 1);
      out.set(2, 2, 1);
    },
    // Constant metric — derivatives vanish identically.
    gInverseDerivativeInto: (out) => {
      out.zero();
    },
  });
  return new LorentzianManifold(chart, g);
}
