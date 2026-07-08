import { test } from "node:test";
import assert from "node:assert/strict";

import { majumdarPapapetrou, Event } from "../src/spacetime/index.ts";
import { lightCone, uniformDirections, absorbedNear } from "../src/lightcone/index.ts";
import { ConeMesh, timeUp } from "../src/render/three/index.ts";

test("trim cuts the surface cleanly at the stop radius — no geometry inside it", () => {
  const holes = [{ mass: 1, x: 0, y: 0 }];
  const M = majumdarPapapetrou(holes);
  const R = 0.4;
  const cone = lightCone(M, Event.of(0, 0, -5), {
    directions: uniformDirections(120),
    samples: 200,
    step: 0.06,
    maxRadius: 12,
    terminate: absorbedNear(holes, R * 0.7), // rays cross into R so the mesh straddles it
  });

  const mesh = new ConeMesh(cone, {
    embedding: timeUp(0.8),
    trim: { centers: holes, radius: R },
  });

  const pos = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.getIndex()!;
  assert.ok(index.count > 0, "mesh is non-empty");

  // Check only vertices the index actually draws (padded grid vertices sit in
  // the buffer but are never referenced).
  let minDist = Infinity;
  let atCut = 0;
  const seen = new Set<number>();
  for (let k = 0; k < index.count; k += 1) {
    const v = index.getX(k);
    if (seen.has(v)) continue;
    seen.add(v);
    const d = Math.hypot(pos.getX(v), pos.getZ(v)); // spatial distance to the hole
    minDist = Math.min(minDist, d);
    if (d < R + 0.02) atCut += 1;
  }
  assert.ok(minDist > R - 1e-3, `no drawn vertex inside the stop radius (min ${minDist} vs R ${R})`);
  assert.ok(atCut > 0, "the surface reaches the cut (clipped vertices sit on R)");

  mesh.dispose();
});
