// Phase 2 checkpoint: straight-line null geodesics in flat 2+1 spacetime.
// Traces one photon and prints (λ, t, x, y, H) — the spatial track should be
// a straight line, t should equal λ, and the null defect H should sit at 0.
//
// Run: node examples/minkowski-null.ts

import { minkowski, Event } from "../src/spacetime/index.ts";
import {
  phaseSpace,
  geodesicHamiltonian,
  hamiltonian,
  nullConeAt,
} from "../src/math/lorentzian/index.ts";
import { RK4 } from "../src/math/numerics/index.ts";

const M = minkowski();
const phase = phaseSpace(M);
const H = hamiltonian(M);
const rk4 = new RK4(geodesicHamiltonian(M));

const theta = Math.PI / 5;
const cone = nullConeAt(M, Event.of(0, -4, 1));
const p = cone.momentum(theta);
const state = phase.create((s) => {
  s.pos.set(0, -4, 1);
  s.mom.set(p.t, p.x, p.y);
});

const dt = 0.5;
console.log(`Minkowski photon, θ = π/5, E = ${cone.energy}`);
console.log("  λ       t        x        y         H");
console.log("-------------------------------------------------");
for (let step = 0; step <= 8; step += 1) {
  const lambda = step * dt;
  console.log(
    `${lambda.toFixed(2).padStart(5)}  ${state.pos.t.toFixed(4).padStart(8)} ` +
      `${state.pos.x.toFixed(4).padStart(8)} ${state.pos.y.toFixed(4).padStart(8)} ` +
      `${H.evaluate(state).toExponential(2).padStart(10)}`,
  );
  rk4.flow(state, dt, 1);
}
