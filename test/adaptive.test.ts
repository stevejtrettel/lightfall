import { test } from "node:test";
import assert from "node:assert/strict";

import { majumdarPapapetrou, minkowski, Event } from "../src/spacetime/index.ts";
import { adaptiveLightCone, absorbedNear } from "../src/lightcone/index.ts";

const holes = [{ mass: 1, x: 0, y: 0 }];
const M = majumdarPapapetrou(holes);
// Apex below the hole (hole is toward +y ⇒ emission angle θ ≈ π/2).
const apex = Event.of(0, 0, -6);

function build(overrides: Record<string, number> = {}) {
  return adaptiveLightCone(M, apex, {
    samples: 140,
    step: 0.08,
    maxRadius: 13,
    terminate: absorbedNear(holes, 0.3),
    initialRays: 24,
    toleranceRel: 0.15,
    maxRays: 5000,
    ...overrides,
  });
}

test("adaptive sampling converges, stays sorted, and leaves no NaNs", () => {
  const { cone, report } = build();
  assert.ok(report.converged, "budget was not exhausted");
  assert.ok(cone.rayCount > 24, "refined beyond the seed ring");
  for (let i = 1; i < cone.rayCount; i += 1) {
    assert.ok(cone.directions[i]! > cone.directions[i - 1]!, "angles strictly increasing");
  }
  for (let k = 0; k < cone.positions.length; k += 1) {
    assert.ok(Number.isFinite(cone.positions[k]!), "no NaN in the grid");
  }
});

test("rays concentrate toward the lensing hole, not away from it", () => {
  const { cone } = build();
  const inWindow = (center: number, half: number): number => {
    let n = 0;
    for (let i = 0; i < cone.rayCount; i += 1) {
      let d = Math.abs(cone.directions[i]! - center);
      d = Math.min(d, 2 * Math.PI - d);
      if (d <= half) n += 1;
    }
    return n;
  };
  const towardHole = inWindow(Math.PI / 2, 0.6); // +y, at the hole
  const awayFromHole = inWindow((3 * Math.PI) / 2, 0.6); // −y, empty sky
  assert.ok(
    towardHole > 2 * awayFromHole,
    `dense toward the hole (${towardHole}) vs away (${awayFromHole})`,
  );
});

test("a huge tolerance refines nothing — parity with the seed ring (flat space)", () => {
  // Flat space: no captured rays ⇒ no fate-mismatch ⇒ tolerance alone decides.
  const { cone } = adaptiveLightCone(minkowski(), Event.of(0, 0, 0), {
    samples: 140,
    step: 0.08,
    initialRays: 24,
    toleranceRel: 1e9,
  });
  assert.equal(cone.rayCount, 24, "no refinement when tolerance is enormous");
});

test("flat space barely refines — the trivial circle is not over-sampled", () => {
  // The relative criterion accepts the circular spreading: a normal tolerance
  // adds few rays where there is no lensing (contrast with the hole case).
  const { cone } = adaptiveLightCone(minkowski(), Event.of(0, 0, 0), {
    samples: 140,
    step: 0.08,
    initialRays: 24,
    toleranceRel: 0.15,
  });
  assert.ok(cone.rayCount < 40, `flat cone stays coarse (got ${cone.rayCount})`);
});
