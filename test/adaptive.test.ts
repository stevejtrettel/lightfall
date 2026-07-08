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
    sagTol: 0.06,
    edgeTol: 0.25,
    maxRays: 5000,
    ...overrides,
  });
}

// Widest separation between two ESCAPING neighbours over their valid extent —
// the largest triangle edge in the continuous surface (fate boundaries excluded;
// their edge is irreducible, floor-limited). Mirrors report.worstGap.
type ConeView = {
  rayCount: number;
  sampleCount: number;
  rayLengths: ArrayLike<number>;
  coord: (i: number, j: number, c: number) => number;
};
function worstEdge(cone: ConeView): number {
  let max = 0;
  for (let i = 0; i < cone.rayCount; i += 1) {
    const j = (i + 1) % cone.rayCount;
    if (cone.rayLengths[i] !== cone.sampleCount || cone.rayLengths[j] !== cone.sampleCount) continue;
    const m = Math.min(cone.rayLengths[i]!, cone.rayLengths[j]!);
    for (let k = 0; k < m; k += 1) {
      max = Math.max(
        max,
        Math.hypot(
          cone.coord(i, k, 0) - cone.coord(j, k, 0),
          cone.coord(i, k, 1) - cone.coord(j, k, 1),
          cone.coord(i, k, 2) - cone.coord(j, k, 2),
        ),
      );
    }
  }
  return max;
}

// Count rays whose emission angle lands within `half` of `center` (wrapped).
function countNear(dirs: Float64Array, center: number, half: number): number {
  let n = 0;
  for (let i = 0; i < dirs.length; i += 1) {
    let d = Math.abs(dirs[i]! - center);
    d = Math.min(d, 2 * Math.PI - d);
    if (d <= half) n += 1;
  }
  return n;
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
  const towardHole = countNear(cone.directions, Math.PI / 2, 0.6); // +y, at the hole
  const awayFromHole = countNear(cone.directions, (3 * Math.PI) / 2, 0.6); // −y, empty sky
  assert.ok(
    towardHole > 2 * awayFromHole,
    `dense toward the hole (${towardHole}) vs away (${awayFromHole})`,
  );
});

test("tightening sagTol resolves the lens WITHOUT flooding the empty sky", () => {
  // The core fix, and the whole point of going absolute. The sag tolerance is
  // absolute, not normalized per-gap, so sharpening the lensed core leaves the
  // calm far field untouched. The OLD relative criterion could not: it read the
  // sky's trivial circular spreading as just as "curved" as a real lens and
  // refined it in lockstep, flooding the empty sky when you tightened for the
  // hole. Edge off (huge) so sagTol is the sole driver; the hole must densify
  // sharply while the sky barely moves.
  const loose = build({ edgeTol: 1e9, sagTol: 0.3 });
  const tight = build({ edgeTol: 1e9, sagTol: 0.02, maxRays: 20000 });

  const skyLoose = countNear(loose.cone.directions, (3 * Math.PI) / 2, 0.6);
  const skyTight = countNear(tight.cone.directions, (3 * Math.PI) / 2, 0.6);
  const holeLoose = countNear(loose.cone.directions, Math.PI / 2, 0.6);
  const holeTight = countNear(tight.cone.directions, Math.PI / 2, 0.6);

  assert.ok(holeTight > holeLoose * 2, `tighter sagTol densifies the lens (${holeLoose} → ${holeTight})`);
  assert.ok(
    skyTight <= skyLoose + 4,
    `the empty sky is NOT flooded (loose ${skyLoose}, tight ${skyTight})`,
  );
});

test("edgeTol drives the even-sampling density everywhere, including the sky", () => {
  // Unlike sagTol, the size test refines the whole surface toward a uniform edge
  // length — so a smaller edgeTol adds rays across the board, the calm sky
  // included. That is the desired *even* sampling, not the pathological flooding.
  const coarse = build({ edgeTol: 0.5 });
  const fine = build({ edgeTol: 0.15, maxRays: 20000 });
  assert.ok(fine.cone.rayCount > coarse.cone.rayCount * 1.5, "a smaller edgeTol adds rays");
  const skyCoarse = countNear(coarse.cone.directions, (3 * Math.PI) / 2, 0.6);
  const skyFine = countNear(fine.cone.directions, (3 * Math.PI) / 2, 0.6);
  assert.ok(skyFine > skyCoarse, `the sky densifies evenly too (${skyCoarse} → ${skyFine})`);
});

test("budget-driven worst-first: more rays close the widest gaps first", () => {
  // Tiny tolerances + deep floor ⇒ never converges, so maxRays is the dial and the
  // heap spends it worst-first. Raising it must shrink the worst escaping edge —
  // the demo's "ray budget" slider relies on exactly this. (A deep floor is
  // required: at the default 2π/2048 the photon-sphere edge is floor-limited and
  // no budget can move it.)
  const opts = { edgeTol: 0.02, sagTol: 0.02, minAngle: (2 * Math.PI) / 1048576 };
  const lean = build({ ...opts, maxRays: 250 });
  const rich = build({ ...opts, maxRays: 2000 });
  assert.ok(rich.cone.rayCount > lean.cone.rayCount, "the larger budget is actually spent");
  assert.ok(
    worstEdge(rich.cone) < worstEdge(lean.cone) * 0.7,
    `budget closes the widest gap (lean ${worstEdge(lean.cone).toFixed(2)}, rich ${worstEdge(rich.cone).toFixed(2)})`,
  );
});

test("huge tolerances refine nothing — parity with the seed ring (flat space)", () => {
  // Flat space: no captured rays ⇒ no fate-mismatch ⇒ tolerances alone decide.
  const { cone } = adaptiveLightCone(minkowski(), Event.of(0, 0, 0), {
    samples: 140,
    step: 0.08,
    initialRays: 24,
    sagTol: 1e9,
    edgeTol: 1e9,
  });
  assert.equal(cone.rayCount, 24, "no refinement when tolerances are enormous");
});

test("flat space refines EVENLY — the trivial circle is not lopsided", () => {
  // With no lens, the edge test alone drives sampling: the circle is refined to a
  // roughly uniform density, not concentrated anywhere. (Contrast the hole case,
  // where the sag/fate tests pull rays toward the lens.)
  const { cone } = adaptiveLightCone(minkowski(), Event.of(0, 0, 0), {
    samples: 140,
    step: 0.08,
    initialRays: 24,
    sagTol: 1e9, // curvature off — pure size-driven, so it MUST be uniform
    edgeTol: 0.4,
  });
  const q0 = countNear(cone.directions, 0, Math.PI / 4);
  const q1 = countNear(cone.directions, Math.PI / 2, Math.PI / 4);
  const q2 = countNear(cone.directions, Math.PI, Math.PI / 4);
  const q3 = countNear(cone.directions, (3 * Math.PI) / 2, Math.PI / 4);
  const lo = Math.min(q0, q1, q2, q3);
  const hi = Math.max(q0, q1, q2, q3);
  assert.ok(hi <= lo + 2, `even around the circle (quadrants ${q0}/${q1}/${q2}/${q3})`);
});
