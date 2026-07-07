import { test } from "node:test";
import assert from "node:assert/strict";

import { minkowski, Event } from "../src/spacetime/index.ts";
import {
  phaseSpace,
  geodesicHamiltonian,
  hamiltonian,
  nullConeAt,
  metric,
  type PhaseView,
} from "../src/math/lorentzian/index.ts";
import { RK4 } from "../src/math/numerics/index.ts";
import { Matrix } from "../src/math/linalg/index.ts";

const M = minkowski();
const phase = phaseSpace(M);
const H = hamiltonian(M);

function photon(t: number, x: number, y: number, theta: number): PhaseView<Event> {
  const p = nullConeAt(M, Event.of(t, x, y)).momentum(theta);
  return phase.create((s) => {
    s.pos.set(t, x, y);
    s.mom.set(p.t, p.x, p.y);
  });
}

test("nullConeAt yields genuinely null momenta at every angle", () => {
  for (let k = 0; k < 12; k += 1) {
    const s = photon(0, -5, 2, (2 * Math.PI * k) / 12);
    assert.ok(Math.abs(H.evaluate(s)) < 1e-14, `H≈0 (got ${H.evaluate(s)})`);
    assert.equal(s.mom.t, -1, "energy normalization E = −p_t = 1");
  }
});

test("Minkowski null geodesic is a straight line at unit coordinate speed", () => {
  const theta = 0.7;
  const x0 = -5;
  const y0 = 2;
  const solver = new RK4(geodesicHamiltonian(M), { step: 0.01 }).solver(photon(0, x0, y0, theta));
  const lambda = 10;
  solver.advanceTo(lambda);
  const end = solver.state;
  assert.ok(Math.abs(end.pos.t - lambda) < 1e-12, "t = λ");
  assert.ok(Math.abs(end.pos.x - (x0 + Math.cos(theta) * lambda)) < 1e-12, "x linear");
  assert.ok(Math.abs(end.pos.y - (y0 + Math.sin(theta) * lambda)) < 1e-12, "y linear");
  const spatialDistance = Math.hypot(end.pos.x - x0, end.pos.y - y0);
  assert.ok(Math.abs(spatialDistance - lambda) < 1e-12, "light travels at coordinate speed 1");
});

test("H and E = −p_t are conserved along the flow", () => {
  const solver = new RK4(geodesicHamiltonian(M), { step: 0.05 }).solver(photon(0, -5, 2, 1.3));
  for (let lambda = 0.5; lambda <= 20; lambda += 0.5) {
    solver.advanceTo(lambda);
    assert.ok(Math.abs(H.evaluate(solver.state)) < 1e-12, "null condition held");
    assert.ok(Math.abs(solver.state.mom.t - -1) < 1e-12, "energy p_t held");
  }
});

test("finite-difference derivative fallback matches an analytic derivative", () => {
  const g = metric({
    dimension: 3,
    gInverseInto: (out, pt) => {
      out.zero();
      out.set(0, 0, -1);
      out.set(1, 1, 1 + pt.buffer[pt.offset + 1]!);
      out.set(2, 2, 1);
    },
  });
  const dG = Matrix.square(3);
  g.gInverseDerivativeInto(dG, Event.of(0, 0.7, 0), 1);
  assert.ok(Math.abs(dG.get(1, 1) - 1) < 1e-4, `∂_x g^{11} ≈ 1 (got ${dG.get(1, 1)})`);
  assert.ok(Math.abs(dG.get(0, 0)) < 1e-6, "∂_x g^{00} ≈ 0");
  assert.ok(Math.abs(dG.get(2, 2)) < 1e-6, "∂_x g^{22} ≈ 0");
});
