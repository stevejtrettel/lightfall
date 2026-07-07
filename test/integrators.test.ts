import { test } from "node:test";
import assert from "node:assert/strict";

import { vec2Space, type Vec2 } from "../src/math/spaces/index.ts";
import { VectorField } from "../src/math/maps/index.ts";
import { RK4, ImplicitMidpoint, DormandPrince } from "../src/math/numerics/index.ts";

// Harmonic oscillator on R² = (q, p), H = ½(q² + p²): q̇ = p, ṗ = −q.
// Exact solution from (1, 0): q = cos λ, p = −sin λ.
const phase = vec2Space("phase(q,p)");
const oscillator = VectorField.inPlace(phase, (out, x) => {
  const q = x.x;
  const p = x.y;
  out.x = p;
  out.y = -q;
});
const energy = (s: Vec2): number => 0.5 * (s.x * s.x + s.y * s.y);
const start = (): Vec2 => phase.create((s) => s.set(1, 0));

test("RK4 (fixed step) tracks one period accurately", () => {
  const solver = new RK4(oscillator, { step: (2 * Math.PI) / 2000 }).solver(start());
  solver.advanceTo(2 * Math.PI);
  assert.ok(Math.abs(solver.state.x - 1) < 1e-6, `q → 1 (got ${solver.state.x})`);
  assert.ok(Math.abs(solver.state.y) < 1e-6, `p → 0 (got ${solver.state.y})`);
});

test("implicit midpoint conserves the quadratic energy to ~machine precision", () => {
  const solver = new ImplicitMidpoint(oscillator, { step: 0.05 }).solver(start());
  solver.advanceTo(0.05 * 4000);
  assert.ok(Math.abs(energy(solver.state) - 0.5) < 1e-9, `energy held (got ${energy(solver.state)})`);
});

test("Dormand–Prince integrates accurately with adaptive steps", () => {
  const solver = new DormandPrince(oscillator, { rtol: 1e-9, atol: 1e-12 }).solver(start());
  solver.advanceTo(2 * Math.PI);
  assert.ok(Math.abs(solver.state.x - 1) < 1e-7, `q → 1 (got ${solver.state.x})`);
  assert.ok(Math.abs(solver.state.y) < 1e-7, `p → 0 (got ${solver.state.y})`);
  assert.ok(Math.abs(energy(solver.state) - 0.5) < 1e-8, "energy stays put");
});

test("dense output lands on intermediate targets (not just step boundaries)", () => {
  // Adaptive steps won't naturally hit λ = π/2; the interpolant must.
  const solver = new DormandPrince(oscillator, { rtol: 1e-9, atol: 1e-12 }).solver(start());
  solver.advanceTo(Math.PI / 2);
  assert.equal(solver.lambda, Math.PI / 2);
  assert.ok(Math.abs(solver.state.x - 0) < 1e-6, `q(π/2) = 0 (got ${solver.state.x})`);
  assert.ok(Math.abs(solver.state.y + 1) < 1e-6, `p(π/2) = −1 (got ${solver.state.y})`);
});

test("advanceTo is monotone and does not disturb the initial value", () => {
  const y0 = start();
  const solver = new DormandPrince(oscillator).solver(y0);
  solver.advanceTo(1);
  solver.advanceTo(2);
  assert.equal(solver.lambda, 2);
  assert.deepEqual([y0.x, y0.y], [1, 0], "y0 untouched by the solver");
  solver.advanceTo(1); // backward is a no-op
  assert.equal(solver.lambda, 2);
});
