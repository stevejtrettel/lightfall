// Phase 3 + robust-numerics checkpoint: a traced null geodesic in
// Majumdar–Papapetrou, the honest integrator comparison, and the payoff of
// adaptive stepping — where a fixed step explodes at the throat, adaptive
// Dormand–Prince shrinks its step and terminates gracefully.
//
// Run: node examples/mp-drift.ts

import { majumdarPapapetrou, Event } from "../src/spacetime/index.ts";
import {
  phaseSpace,
  geodesicHamiltonian,
  hamiltonian,
  nullConeAt,
} from "../src/math/lorentzian/index.ts";
import { RK4, ImplicitMidpoint, DormandPrince } from "../src/math/numerics/index.ts";

const M = majumdarPapapetrou([{ mass: 1, x: 0, y: 0 }]);
const phase = phaseSpace(M);
const H = hamiltonian(M);
const flow = geodesicHamiltonian(M);

const L = (s: { pos: Event; mom: Event }): number => s.pos.x * s.mom.y - s.pos.y * s.mom.x;
function launch(x: number, y: number) {
  const p = nullConeAt(M, Event.of(0, x, y)).momentum(0);
  return phase.create((s) => {
    s.pos.set(0, x, y);
    s.mom.set(p.t, p.x, p.y);
  });
}

console.log("Majumdar–Papapetrou, single unit-mass hole at the origin.\n");

console.log("Regular fly-by (b = 4): |ΔH| at λ = 60");
const rk4 = new RK4(flow, { step: 0.02 }).solver(launch(-15, 4));
const mid = new ImplicitMidpoint(flow, { step: 0.02 }).solver(launch(-15, 4));
const dp = new DormandPrince(flow, { rtol: 1e-9, atol: 1e-11 }).solver(launch(-15, 4));
const l0 = L(rk4.state);
rk4.advanceTo(60);
mid.advanceTo(60);
dp.advanceTo(60);
for (const [name, s] of [["RK4", rk4], ["midpoint", mid], ["DoPri", dp]] as const) {
  console.log(
    `  ${name.padEnd(9)} |ΔH|=${Math.abs(H.evaluate(s.state)).toExponential(2)} ` +
      `|ΔL|=${Math.abs(L(s.state) - l0).toExponential(2)} alive=${s.alive}`,
  );
}

console.log("\nClose passage (b = 3) — the throat:");
const rkClose = new RK4(flow, { step: 0.02 }).solver(launch(-15, 3));
const dpClose = new DormandPrince(flow, { rtol: 1e-9, atol: 1e-11, minStep: 1e-9 }).solver(launch(-15, 3));
rkClose.advanceTo(60);
dpClose.advanceTo(60);
console.log(
  `  RK4 (fixed):   reached λ=60, |H|=${Math.abs(H.evaluate(rkClose.state)).toExponential(2)} ` +
    `alive=${rkClose.alive}  ← blows up at the throat`,
);
console.log(
  `  DoPri (adapt): halted at λ=${dpClose.lambda.toFixed(2)}, |H|=${Math.abs(H.evaluate(dpClose.state)).toExponential(2)} ` +
    `alive=${dpClose.alive}  ← step floored, terminated cleanly`,
);
