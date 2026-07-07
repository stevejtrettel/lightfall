import { test } from "node:test";
import assert from "node:assert/strict";

import { majumdarPapapetrou, Event } from "../src/spacetime/index.ts";
import {
  phaseSpace,
  geodesicHamiltonian,
  hamiltonian,
  nullConeAt,
  type PhaseView,
} from "../src/math/lorentzian/index.ts";
import { RK4, DormandPrince } from "../src/math/numerics/index.ts";

const centeredHole = majumdarPapapetrou([{ mass: 1, x: 0, y: 0 }]);
const flow = geodesicHamiltonian(centeredHole);

function photon(x: number, y: number, theta: number): PhaseView<Event> {
  const p = nullConeAt(centeredHole, Event.of(0, x, y)).momentum(theta);
  return phaseSpace(centeredHole).create((s) => {
    s.pos.set(0, x, y);
    s.mom.set(p.t, p.x, p.y);
  });
}

const angularMomentum = (s: PhaseView<Event>): number =>
  s.pos.x * s.mom.y - s.pos.y * s.mom.x;

test("null momenta at the apex are genuinely null", () => {
  const H = hamiltonian(centeredHole);
  for (let k = 0; k < 16; k += 1) {
    const s = photon(3, 1, (2 * Math.PI * k) / 16);
    assert.ok(Math.abs(H.evaluate(s)) < 1e-12, `H≈0 (got ${H.evaluate(s)})`);
  }
});

test("static ⇒ energy and angular momentum are conserved on a regular fly-by", () => {
  const H = hamiltonian(centeredHole);
  const solver = new RK4(flow, { step: 0.02 }).solver(photon(-15, 4, 0));
  const l0 = angularMomentum(solver.state);
  for (let lambda = 0.5; lambda <= 55; lambda += 0.5) {
    solver.advanceTo(lambda);
    assert.ok(Math.abs(solver.state.mom.t - -1) < 1e-13, "E = −p_t held (RHS bug detector)");
    assert.ok(Math.abs(angularMomentum(solver.state) - l0) < 1e-8, "L conserved (symmetry)");
    assert.ok(Math.abs(H.evaluate(solver.state)) < 1e-6, "null condition stays ≈ 0");
  }
});

test("weak-field deflection approaches 4m/b", () => {
  const m = 1;
  const b = 200;
  const D = 4000;
  const solver = new DormandPrince(flow, { rtol: 1e-9, atol: 1e-11 }).solver(photon(-D, b, 0));
  solver.advanceTo(2.2 * D); // travel well past the hole (spatial speed ≈ 1)
  assert.ok(solver.state.pos.x > D, "photon exited the far side");
  const deflection = -Math.atan2(solver.state.mom.y, solver.state.mom.x);
  const predicted = (4 * m) / b;
  assert.ok(
    Math.abs(deflection / predicted - 1) < 0.03,
    `deflection ${deflection} vs 4m/b ${predicted}`,
  );
});

test("Dormand–Prince agrees with fine fixed-step RK4 on a regular fly-by", () => {
  const dp = new DormandPrince(flow, { rtol: 1e-10, atol: 1e-12 }).solver(photon(-15, 4, 0));
  const rk = new RK4(flow, { step: 0.002 }).solver(photon(-15, 4, 0));
  dp.advanceTo(40);
  rk.advanceTo(40);
  const gap = Math.hypot(dp.state.pos.x - rk.state.pos.x, dp.state.pos.y - rk.state.pos.y);
  assert.ok(gap < 1e-4, `adaptive and fine fixed-step agree (gap ${gap})`);
});

test("adaptive Dormand–Prince terminates cleanly at the throat instead of blowing up", () => {
  const solver = new DormandPrince(flow, { rtol: 1e-9, atol: 1e-11 }).solver(photon(-15, 3, 0));
  solver.advanceTo(60); // a plunging (captured) ray
  assert.equal(solver.alive, false, "the plunging ray terminated");
  assert.ok(solver.lambda > 5 && solver.lambda < 60, "it traced most of the way before flooring");
  assert.ok(
    Number.isFinite(solver.state.pos.x) && Number.isFinite(solver.state.pos.y),
    "the reported state stays finite (no NaN/Inf blowup)",
  );
});

test("photon sphere: a tangential ray at ρ = m stays on the circle", () => {
  const solver = new RK4(flow, { step: 0.005 }).solver(photon(1, 0, Math.PI / 2));
  let maxDeviation = 0;
  for (let lambda = 0.005; lambda <= 1.5; lambda += 0.005) {
    solver.advanceTo(lambda);
    maxDeviation = Math.max(
      maxDeviation,
      Math.abs(Math.hypot(solver.state.pos.x, solver.state.pos.y) - 1),
    );
  }
  assert.ok(maxDeviation < 1e-2, `stayed near ρ=m over a quarter orbit (max dev ${maxDeviation})`);
});
