import { test } from "node:test";
import assert from "node:assert/strict";

import { vec2Space, type Vec2 } from "../src/math/spaces/index.ts";
import { VectorField } from "../src/math/maps/index.ts";
import { RK4, ImplicitMidpoint } from "../src/math/numerics/index.ts";

// Harmonic oscillator as a Hamiltonian flow on R² = (q, p), H = ½(q² + p²):
//   q̇ = p,  ṗ = −q.
// Exact solution is uniform rotation on the circle q² + p² = const; the
// energy H is a quadratic invariant.
const phase = vec2Space("phase(q,p)");
const oscillator = VectorField.inPlace(phase, (out, x) => {
  const q = x.x;
  const p = x.y;
  out.x = p;
  out.y = -q;
});

const energy = (s: Vec2): number => 0.5 * (s.x * s.x + s.y * s.y);
const start = (): Vec2 => phase.create((s) => s.set(1, 0));

test("RK4 tracks one period of the oscillator accurately", () => {
  const rk4 = new RK4(oscillator);
  const steps = 2000;
  const dt = (2 * Math.PI) / steps; // exactly one period
  const end = rk4.flow(start(), dt, steps);
  // after one full period the state returns to (1, 0)
  assert.ok(Math.abs(end.x - 1) < 1e-6, `q returned to 1 (got ${end.x})`);
  assert.ok(Math.abs(end.y) < 1e-6, `p returned to 0 (got ${end.y})`);
});

test("implicit midpoint conserves the quadratic energy to ~machine precision", () => {
  const mid = new ImplicitMidpoint(oscillator);
  const dt = 0.05;
  const steps = 4000; // ~32 periods
  const s = start();
  const e0 = energy(s);
  mid.flow(s, dt, steps);
  const drift = Math.abs(energy(s) - e0);
  // Gauss method ⇒ exact quadratic-invariant conservation, up to round-off.
  assert.ok(drift < 1e-9, `energy drift ${drift} should be ~0`);
});

test("RK4 energy drifts more than implicit midpoint over a long run", () => {
  const dt = 0.05;
  const steps = 4000;

  const sMid = start();
  const e0 = energy(sMid);
  new ImplicitMidpoint(oscillator).flow(sMid, dt, steps);
  const midDrift = Math.abs(energy(sMid) - e0);

  const sRk4 = start();
  new RK4(oscillator).flow(sRk4, dt, steps);
  const rk4Drift = Math.abs(energy(sRk4) - e0);

  // RK4 stays bounded (it is high-order and accurate) but does not conserve
  // the invariant the way the symplectic method does.
  assert.ok(rk4Drift > midDrift, `RK4 drift ${rk4Drift} > midpoint ${midDrift}`);
  assert.ok(rk4Drift < 1e-2, "RK4 remains well-behaved over this run");
});

test("integrate returns n+1 snapshots, first equal to the initial state", () => {
  const rk4 = new RK4(oscillator);
  const traj = rk4.integrate(start(), 0.1, 10);
  assert.equal(traj.length, 11);
  assert.deepEqual([traj[0]!.x, traj[0]!.y], [1, 0]);
  // snapshots are independent copies, not aliases of one mutated buffer
  assert.notEqual(traj[0]!.buffer, traj[1]!.buffer);
});
