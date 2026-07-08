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

// Worst separation between neighbouring ESCAPING endpoints — the size of the
// largest visible triangle in the lensed fan.
type ConeView = {
  rayCount: number;
  sampleCount: number;
  rayLengths: ArrayLike<number>;
  coord: (i: number, j: number, c: number) => number;
};
function worstEscapeGap(cone: ConeView): number {
  let max = 0;
  for (let i = 0; i < cone.rayCount; i += 1) {
    const j = (i + 1) % cone.rayCount;
    if (cone.rayLengths[i] !== cone.sampleCount || cone.rayLengths[j] !== cone.sampleCount) continue;
    const a = cone.rayLengths[i]! - 1;
    const b = cone.rayLengths[j]! - 1;
    max = Math.max(
      max,
      Math.hypot(
        cone.coord(i, a, 0) - cone.coord(j, b, 0),
        cone.coord(i, a, 1) - cone.coord(j, b, 1),
        cone.coord(i, a, 2) - cone.coord(j, b, 2),
      ),
    );
  }
  return max;
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

test("tighter angular tolerance adds rays in the lensed cone (and still converges)", () => {
  // The full-extent error metric sees the lensed far field, so tightening the
  // relative tolerance must densify the curved region — this is what the demo's
  // angular-detail slider drives. A loose vs. tight pass, both under budget.
  const loose = build({ toleranceRel: 0.15 });
  const tight = build({ toleranceRel: 0.03, maxRays: 20000 });
  assert.ok(loose.report.converged && tight.report.converged, "both converge under budget");
  assert.ok(
    tight.cone.rayCount > loose.cone.rayCount * 1.3,
    `tighter tolerance spends more rays (loose ${loose.cone.rayCount}, tight ${tight.cone.rayCount})`,
  );
});

test("the escape-gap cap fills stretched-thin fans the curvature test misses", () => {
  const base = build({ maxRays: 20000 });
  const capped = build({ maxRays: 20000, maxEscapeGap: 0.6 });
  assert.ok(capped.report.converged, "converges under the cap");
  assert.ok(capped.cone.rayCount > base.cone.rayCount, "the cap spends extra rays on the fans");
  assert.ok(
    worstEscapeGap(capped.cone) < worstEscapeGap(base.cone),
    `cap shrinks the worst escaping endpoint gap (base ${worstEscapeGap(base.cone).toFixed(2)}, capped ${worstEscapeGap(capped.cone).toFixed(2)})`,
  );
});

test("budget-driven worst-first: more rays close the widest divergers first", () => {
  // Tiny cap + deep floor ⇒ never converges, so maxRays is the dial and the heap
  // spends it worst-first. Raising it must shrink the worst endpoint gap — the
  // demo's "ray budget" slider relies on exactly this.
  const opts = { maxEscapeGap: 0.05, minAngle: (2 * Math.PI) / 1048576 };
  const lean = build({ ...opts, maxRays: 250 });
  const rich = build({ ...opts, maxRays: 2000 });
  assert.ok(rich.cone.rayCount > lean.cone.rayCount, "the larger budget is actually spent");
  assert.ok(
    worstEscapeGap(rich.cone) < worstEscapeGap(lean.cone),
    `budget closes the widest gap (lean ${worstEscapeGap(lean.cone).toFixed(2)}, rich ${worstEscapeGap(rich.cone).toFixed(2)})`,
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
