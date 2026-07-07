// Phase 3 checkpoint: a traced null geodesic in Majumdar–Papapetrou, and the
// honest integrator comparison. Two rays around a single unit-mass hole:
//
//   • a regular fly-by (periapsis well above the photon sphere) — every
//     conserved quantity is held tight by both integrators;
//   • a close passage — the fixed step dies where U → ∞ (near-hole stiffness,
//     plan §7 / §11), the same failure a termination predicate + adaptive
//     stepping will later handle.
//
// Run: node examples/mp-drift.ts

import { majumdarPapapetrou, Event } from "../src/spacetime/index.ts";
import {
  phaseSpace,
  geodesicHamiltonian,
  hamiltonian,
  nullConeAt,
} from "../src/math/lorentzian/index.ts";
import { RK4, ImplicitMidpoint } from "../src/math/numerics/index.ts";

const M = majumdarPapapetrou([{ mass: 1, x: 0, y: 0 }]);
const phase = phaseSpace(M);
const H = hamiltonian(M);
const flow = geodesicHamiltonian(M);

const L = (s: { pos: Event; mom: Event }): number =>
  s.pos.x * s.mom.y - s.pos.y * s.mom.x;

function launch(x: number, y: number, theta = 0) {
  const p = nullConeAt(M, Event.of(0, x, y)).momentum(theta);
  return phase.create((s) => {
    s.pos.set(0, x, y);
    s.mom.set(p.t, p.x, p.y);
  });
}

function driftTable(label: string, x0: number, y0: number, dt: number) {
  console.log(`\n${label}  (launch x=${x0}, y=${y0}, dt=${dt})`);
  console.log("steps    |ΔE| RK4   |ΔE| mid   |ΔL| RK4   |ΔL| mid   |ΔH| RK4   |ΔH| mid   rMin");
  const rk4 = new RK4(flow);
  const mid = new ImplicitMidpoint(flow);
  const sR = launch(x0, y0);
  const sM = launch(x0, y0);
  const l0 = L(sR);
  let rMin = Infinity;
  let done = 0;
  for (const target of [500, 1500, 3000]) {
    const n = target - done;
    for (let i = 0; i < n; i += 1) {
      rk4.flow(sR, dt, 1);
      mid.flow(sM, dt, 1);
      rMin = Math.min(rMin, Math.hypot(sR.pos.x, sR.pos.y));
    }
    done = target;
    const fmt = (v: number) => v.toExponential(1).padStart(9);
    console.log(
      `${String(target).padEnd(8)} ${fmt(Math.abs(sR.mom.t + 1))} ${fmt(Math.abs(sM.mom.t + 1))} ` +
        `${fmt(Math.abs(L(sR) - l0))} ${fmt(Math.abs(L(sM) - l0))} ` +
        `${fmt(Math.abs(H.evaluate(sR)))} ${fmt(Math.abs(H.evaluate(sM)))} ${rMin.toFixed(2)}`,
    );
  }
}

console.log("Majumdar–Papapetrou, single unit-mass hole at the origin.");
driftTable("Regular fly-by (b = 4)", -15, 4, 0.02);
driftTable("Close passage (b = 3) — near-hole stiffness", -15, 3, 0.02);
