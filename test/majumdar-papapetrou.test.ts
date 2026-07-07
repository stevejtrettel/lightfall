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
import { RK4 } from "../src/math/numerics/index.ts";

const centeredHole = majumdarPapapetrou([{ mass: 1, x: 0, y: 0 }]);

function photon(
  M: ReturnType<typeof majumdarPapapetrou>,
  x: number,
  y: number,
  theta: number,
): PhaseView<Event> {
  const p = nullConeAt(M, Event.of(0, x, y)).momentum(theta);
  return phaseSpace(M).create((s) => {
    s.pos.set(0, x, y);
    s.mom.set(p.t, p.x, p.y);
  });
}

const angularMomentum = (s: PhaseView<Event>): number =>
  s.pos.x * s.mom.y - s.pos.y * s.mom.x;

test("null momenta at the apex are genuinely null", () => {
  const H = hamiltonian(centeredHole);
  for (let k = 0; k < 16; k += 1) {
    const s = photon(centeredHole, 3, 1, (2 * Math.PI * k) / 16);
    assert.ok(Math.abs(H.evaluate(s)) < 1e-12, `H≈0 (got ${H.evaluate(s)})`);
  }
});

test("static ⇒ energy E = −p_t is conserved to floating point (RHS bug detector)", () => {
  const rk4 = new RK4(geodesicHamiltonian(centeredHole));
  const traj = rk4.integrate(photon(centeredHole, -15, 4, 0), 0.02, 3000);
  for (const s of traj) {
    assert.ok(Math.abs(s.mom.t - -1) < 1e-13, `p_t held (got ${s.mom.t})`);
  }
});

test("angular momentum (rotational Noether charge) is conserved on a regular fly-by", () => {
  const rk4 = new RK4(geodesicHamiltonian(centeredHole));
  const H = hamiltonian(centeredHole);
  const traj = rk4.integrate(photon(centeredHole, -15, 4, 0), 0.02, 3000);
  const l0 = angularMomentum(traj[0]!);
  for (const s of traj) {
    assert.ok(Math.abs(angularMomentum(s) - l0) < 1e-8, "L conserved (symmetry)");
    assert.ok(Math.abs(H.evaluate(s)) < 1e-6, "null condition stays ≈ 0");
  }
});

test("weak-field deflection approaches 4m/b", () => {
  const m = 1;
  const b = 200;
  const D = 4000;
  const rk4 = new RK4(geodesicHamiltonian(centeredHole));
  const s = photon(centeredHole, -D, b, 0); // heading +x, initial direction 0
  let steps = 0;
  while (s.pos.x < D && steps < 40_000) {
    rk4.flow(s, 1.0, 1);
    steps += 1;
  }
  // ẋ ∝ p spatially (the U⁻² factor cancels in the ratio), so the outgoing
  // direction is atan2(p_y, p_x); the ray bends toward the mass (p_y < 0).
  const deflection = -Math.atan2(s.mom.y, s.mom.x);
  const predicted = (4 * m) / b;
  assert.ok(
    Math.abs(deflection / predicted - 1) < 0.03,
    `deflection ${deflection} vs 4m/b ${predicted}`,
  );
});

test("photon sphere: a tangential ray at ρ = m stays on the circle", () => {
  const rk4 = new RK4(geodesicHamiltonian(centeredHole));
  const s = photon(centeredHole, 1, 0, Math.PI / 2); // launch at ρ=m=1, tangential
  let maxDeviation = 0;
  for (let i = 0; i < 300; i += 1) {
    rk4.flow(s, 0.005, 1);
    maxDeviation = Math.max(maxDeviation, Math.abs(Math.hypot(s.pos.x, s.pos.y) - 1));
  }
  assert.ok(maxDeviation < 1e-2, `stayed near ρ=m over a quarter orbit (max dev ${maxDeviation})`);
});
