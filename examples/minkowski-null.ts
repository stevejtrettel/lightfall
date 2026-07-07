// Phase 2 checkpoint: straight-line null geodesics in flat 2+1 spacetime.
// Traces one photon and prints (λ, t, x, y, H) via advanceTo on the Solver.
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

const theta = Math.PI / 5;
const cone = nullConeAt(M, Event.of(0, -4, 1));
const p = cone.momentum(theta);
const solver = new RK4(geodesicHamiltonian(M), { step: 0.1 }).solver(
  phase.create((s) => {
    s.pos.set(0, -4, 1);
    s.mom.set(p.t, p.x, p.y);
  }),
);

console.log(`Minkowski photon, θ = π/5, E = ${cone.energy}`);
console.log("  λ       t        x        y         H");
console.log("-------------------------------------------------");
for (let step = 0; step <= 8; step += 1) {
  solver.advanceTo(step * 0.5);
  const s = solver.state;
  console.log(
    `${(step * 0.5).toFixed(2).padStart(5)}  ${s.pos.t.toFixed(4).padStart(8)} ` +
      `${s.pos.x.toFixed(4).padStart(8)} ${s.pos.y.toFixed(4).padStart(8)} ` +
      `${H.evaluate(s).toExponential(2).padStart(10)}`,
  );
}
