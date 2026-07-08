import { test } from "node:test";
import assert from "node:assert/strict";

import { majumdarPapapetrou, Event } from "../src/spacetime/index.ts";
import { buildCone, COARSE_CONE, REFINE_CONE, absorbedNear } from "../src/lightcone/index.ts";

const holes = [{ mass: 1, x: 0, y: 0 }];
const M = majumdarPapapetrou(holes);
const apex = Event.of(0, 0, -5);
const sceneOpts = { lambdaMax: 12, maxRadius: 12, terminate: absorbedNear(holes, 0.35) };

test("coarse and refine both build valid cones; refine is denser", () => {
  const coarse = buildCone(M, apex, COARSE_CONE, sceneOpts);
  const refine = buildCone(M, apex, REFINE_CONE, sceneOpts);

  assert.ok(coarse.cone.rayCount >= COARSE_CONE.initialRays, "coarse seeded");
  assert.ok(coarse.cone.rayCount <= COARSE_CONE.maxRays, "coarse respects its budget");
  assert.ok(refine.cone.rayCount > coarse.cone.rayCount, "refine spends more rays");
  assert.equal(refine.cone.sampleCount, REFINE_CONE.samples, "refine uses its λ sample count");

  for (const c of [coarse.cone, refine.cone]) {
    for (let k = 0; k < c.positions.length; k += 1) {
      assert.ok(Number.isFinite(c.positions[k]!), "no NaN in the grid");
    }
  }
});

test("the scene's lambdaMax sets the affine span independent of quality", () => {
  const { cone } = buildCone(M, apex, COARSE_CONE, { ...sceneOpts, lambdaMax: 8 });
  assert.ok(Math.abs(cone.lambdas[cone.sampleCount - 1]! - 8) < 1e-9, "traced out to λ = 8");
});
