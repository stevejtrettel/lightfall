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

// Launch a photon: state (pos = event, mom = null covector for angle θ).
function photon(t: number, x: number, y: number, theta: number): PhaseView<Event> {
  const cone = nullConeAt(M, Event.of(t, x, y));
  const p = cone.momentum(theta);
  return phase.create((s) => {
    s.pos.set(t, x, y);
    s.mom.set(p.t, p.x, p.y);
  });
}

test("nullConeAt yields genuinely null momenta at every angle", () => {
  for (let k = 0; k < 12; k += 1) {
    const theta = (2 * Math.PI * k) / 12;
    const s = photon(0, -5, 2, theta);
    assert.ok(Math.abs(H.evaluate(s)) < 1e-14, `H≈0 at θ=${theta} (got ${H.evaluate(s)})`);
    assert.equal(s.mom.t, -1, "energy normalization E = −p_t = 1");
  }
});

test("Minkowski null geodesic is a straight line at unit coordinate speed", () => {
  const theta = 0.7;
  const x0 = -5;
  const y0 = 2;
  const rk4 = new RK4(geodesicHamiltonian(M));
  const dt = 0.01;
  const steps = 1000;
  const end = rk4.flow(photon(0, x0, y0, theta), dt, steps);

  const lambda = dt * steps; // for Minkowski, t = λ (E = 1)
  assert.ok(Math.abs(end.pos.t - lambda) < 1e-12, "t = λ");
  assert.ok(Math.abs(end.pos.x - (x0 + Math.cos(theta) * lambda)) < 1e-12, "x linear");
  assert.ok(Math.abs(end.pos.y - (y0 + Math.sin(theta) * lambda)) < 1e-12, "y linear");

  // spatial speed = |dx/dt| = 1
  const dx = end.pos.x - x0;
  const dy = end.pos.y - y0;
  const spatialDistance = Math.hypot(dx, dy);
  assert.ok(Math.abs(spatialDistance - lambda) < 1e-12, "light travels at coordinate speed 1");
});

test("H and E = −p_t are conserved along the flow", () => {
  const rk4 = new RK4(geodesicHamiltonian(M));
  const traj = rk4.integrate(photon(0, -5, 2, 1.3), 0.05, 400);
  for (const s of traj) {
    assert.ok(Math.abs(H.evaluate(s)) < 1e-12, "null condition held");
    assert.ok(Math.abs(s.mom.t - -1) < 1e-12, "energy p_t held");
  }
});

test("finite-difference derivative fallback matches an analytic derivative", () => {
  // g^{11}(x) = 1 + x (position-dependent), no analytic derivative supplied.
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
  g.gInverseDerivativeInto(dG, Event.of(0, 0.7, 0), 1); // ∂ wrt coordinate x
  assert.ok(Math.abs(dG.get(1, 1) - 1) < 1e-4, `∂_x g^{11} ≈ 1 (got ${dG.get(1, 1)})`);
  assert.ok(Math.abs(dG.get(0, 0)) < 1e-6, "∂_x g^{00} ≈ 0");
  assert.ok(Math.abs(dG.get(2, 2)) < 1e-6, "∂_x g^{22} ≈ 0");
});
