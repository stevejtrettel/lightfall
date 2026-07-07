// Harmonic oscillator drift comparison across all three schemes — a miniature
// of the geodesic-flow validation (plan §7). Same Solver interface for the
// fixed-step and adaptive methods; `advanceTo(λ)` at each checkpoint.
//
// Run: node examples/harmonic-oscillator.ts

import { vec2Space, type Vec2 } from "../src/math/spaces/index.ts";
import { VectorField } from "../src/math/maps/index.ts";
import { RK4, ImplicitMidpoint, DormandPrince } from "../src/math/numerics/index.ts";

const phase = vec2Space("phase(q,p)");
const oscillator = VectorField.inPlace(phase, (out, x) => {
  const q = x.x;
  const p = x.y;
  out.x = p;
  out.y = -q;
});
const energy = (s: Vec2): number => 0.5 * (s.x * s.x + s.y * s.y);
const start = (): Vec2 => phase.create((s) => s.set(1, 0));

const rk4 = new RK4(oscillator, { step: 0.05 }).solver(start());
const mid = new ImplicitMidpoint(oscillator, { step: 0.05 }).solver(start());
const dp = new DormandPrince(oscillator, { rtol: 1e-8, atol: 1e-10 }).solver(start());

console.log("Harmonic oscillator, H₀ = 0.5");
console.log("λ          |ΔH| RK4     |ΔH| midpoint  |ΔH| DoPri");
console.log("---------------------------------------------------");
for (const lambda of [10, 100, 1000, 10000]) {
  rk4.advanceTo(lambda);
  mid.advanceTo(lambda);
  dp.advanceTo(lambda);
  const f = (s: Vec2) => Math.abs(energy(s) - 0.5).toExponential(3).padStart(11);
  console.log(`${String(lambda).padEnd(10)} ${f(rk4.state)} ${f(mid.state)} ${f(dp.state)}`);
}
