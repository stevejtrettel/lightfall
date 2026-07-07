// Harmonic oscillator drift comparison — a miniature of the geodesic-flow
// validation the plan calls for in §7. Same scheme interface, same kind of
// table: how far each integrator lets a conserved quantity wander.
//
// Run: node examples/harmonic-oscillator.ts

import { vec2Space, type Vec2 } from "../src/math/spaces/index.ts";
import { VectorField } from "../src/math/maps/index.ts";
import { RK4, ImplicitMidpoint } from "../src/math/numerics/index.ts";

const phase = vec2Space("phase(q,p)");

// H = ½(q² + p²):  q̇ = p,  ṗ = −q.
const oscillator = VectorField.inPlace(phase, (out, x) => {
  const q = x.x;
  const p = x.y;
  out.x = p;
  out.y = -q;
});

const energy = (s: Vec2): number => 0.5 * (s.x * s.x + s.y * s.y);

const dt = 0.05;
const checkpoints = [100, 1_000, 10_000, 100_000];

const rk4 = new RK4(oscillator);
const mid = new ImplicitMidpoint(oscillator);

const rk4State = phase.create((s) => s.set(1, 0));
const midState = phase.create((s) => s.set(1, 0));
const e0 = energy(rk4State);

let done = 0;
console.log(`Harmonic oscillator, dt = ${dt}, H₀ = ${e0}`);
console.log("steps      |ΔH| RK4        |ΔH| implicit-midpoint");
console.log("-----------------------------------------------------");
for (const target of checkpoints) {
  rk4.flow(rk4State, dt, target - done);
  mid.flow(midState, dt, target - done);
  done = target;
  const rk4Drift = Math.abs(energy(rk4State) - e0);
  const midDrift = Math.abs(energy(midState) - e0);
  console.log(
    `${String(target).padEnd(10)} ${rk4Drift.toExponential(3).padEnd(15)} ${midDrift.toExponential(3)}`,
  );
}
