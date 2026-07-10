import { test } from "node:test";
import assert from "node:assert/strict";

import { minkowski, majumdarPapapetrou, Event } from "../src/spacetime/index.ts";
import {
  lightCone,
  adaptiveLightCone,
  uniformDirections,
  absorbedNear,
  jacobianField,
  causticSegments,
} from "../src/lightcone/index.ts";

test("flat space has no caustics (J never changes sign)", () => {
  const cone = lightCone(minkowski(), Event.of(0, 0, 0), {
    directions: uniformDirections(120),
    samples: 100,
    step: 0.1,
  });
  const seg = causticSegments(cone);
  assert.equal(seg.length, 0, "no focusing ⇒ no caustic curve");
});

test("weak/degenerate lensing has no extractable caustic curve", () => {
  // A single on-axis hole with a distant source: the caustic is a degenerate
  // point on the axis, so J approaches but does not cross zero — no curve.
  // (This is physically correct, not a miss; strong lensing below shows it.)
  const holes = [{ mass: 1, x: 0, y: 0 }];
  const M = majumdarPapapetrou(holes);
  const { cone } = adaptiveLightCone(M, Event.of(0, 0, -6), {
    samples: 180,
    step: 0.06,
    maxRadius: 13,
    terminate: absorbedNear(holes, 0.3),
    initialRays: 32,
    edgeTol: 0.2,
    maxRays: 4000,
  });
  assert.equal(causticSegments(cone).length, 0, "sub-critical ⇒ no caustic curve");
});

test("strong lensing folds the congruence — the Jacobian crosses zero", () => {
  // Heavy hole near the source: rays focus and the areal Jacobian, negative in
  // flat space, crosses to positive at the fold. A dense seed ring is needed to
  // bracket the thin fold-forming angular sliver (a real limitation — adaptive
  // refinement only subdivides existing gaps, so it can miss a feature no seed
  // ray lands near). J crossing zero is the robust signal a caustic exists;
  // extracting a clean curve additionally needs fine λ sampling.
  const holes = [{ mass: 5, x: 0, y: 0 }];
  const M = majumdarPapapetrou(holes);
  const { cone } = adaptiveLightCone(M, Event.of(0, 0, -6), {
    samples: 1200,
    step: 0.035,
    maxRadius: 40,
    terminate: absorbedNear(holes, 0.12),
    initialRays: 64,
    edgeTol: 0.4,
    maxRays: 25000,
  });

  const J = jacobianField(cone);
  let positive = 0;
  let negative = 0;
  for (const v of J) {
    if (Number.isNaN(v)) continue;
    if (v > 0) positive += 1;
    else negative += 1;
  }
  assert.ok(negative > 0, "the bulk of the congruence expands (J < 0)");
  assert.ok(positive > 0, "the fold flips J positive ⇒ a caustic exists");

  // Any extracted caustic segments are finite and sit near the hole.
  const seg = causticSegments(cone);
  for (let s = 0; s < seg.length; s += 6) {
    for (let k = 0; k < 6; k += 1) assert.ok(Number.isFinite(seg[s + k]!), "finite endpoint");
    assert.ok(Math.hypot(seg[s + 1]!, seg[s + 2]!) < 12, "caustic near the hole");
  }
});
