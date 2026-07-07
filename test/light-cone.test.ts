import { test } from "node:test";
import assert from "node:assert/strict";

import { minkowski, majumdarPapapetrou, Event } from "../src/spacetime/index.ts";
import { lightCone, uniformDirections } from "../src/lightcone/index.ts";

test("apex row is exactly the event for every ray", () => {
  const cone = lightCone(minkowski(), Event.of(0, 2, -1), {
    directions: uniformDirections(32),
    samples: 20,
    step: 0.25,
  });
  for (let i = 0; i < cone.rayCount; i += 1) {
    assert.equal(cone.coord(i, 0, 0), 0, "t");
    assert.equal(cone.coord(i, 0, 1), 2, "x");
    assert.equal(cone.coord(i, 0, 2), -1, "y");
  }
});

test("Minkowski wavefront is a circle of radius t (null ⇒ unit speed)", () => {
  const apexX = 2;
  const apexY = -1;
  const cone = lightCone(minkowski(), Event.of(0, apexX, apexY), {
    directions: uniformDirections(64),
    samples: 60,
    step: 0.2,
  });
  const front = cone.wavefront(5); // packed (t, x, y)
  assert.equal(front.length / 3, 64, "every ray reached t = 5");
  for (let k = 0; k < front.length; k += 3) {
    assert.equal(front[k], 5, "slice is at t = 5");
    const r = Math.hypot(front[k + 1]! - apexX, front[k + 2]! - apexY);
    assert.ok(Math.abs(r - 5) < 1e-9, `wavefront radius = t (got ${r})`);
  }
});

test("Majumdar–Papapetrou wavefront is closed but lensed (not a circle)", () => {
  const apexX = 3;
  const apexY = 0;
  const M = majumdarPapapetrou([{ mass: 1, x: 0, y: 0 }]);
  const cone = lightCone(M, Event.of(0, apexX, apexY), {
    directions: uniformDirections(180),
    samples: 120,
    step: 0.1,
    maxRadius: 40,
  });
  const front = cone.wavefront(2.5);
  const n = front.length / 3;
  assert.ok(n > 100, `most rays reached the front (got ${n})`);

  // Distance of each front point from the apex: constant for a flat circle,
  // spread out here because the hole delays/bends the near side (lensing).
  let rMin = Infinity;
  let rMax = 0;
  for (let k = 0; k < front.length; k += 3) {
    const r = Math.hypot(front[k + 1]! - apexX, front[k + 2]! - apexY);
    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
  }
  assert.ok(rMax - rMin > 0.05, `wavefront is lensed, not circular (spread ${rMax - rMin})`);
});

test("rays that leave maxRadius terminate early (shorter rayLength)", () => {
  const cone = lightCone(minkowski(), Event.of(0, 0, 0), {
    directions: uniformDirections(16),
    samples: 100,
    step: 0.5, // λ up to ~49.5, well past maxRadius
    maxRadius: 10,
  });
  for (let i = 0; i < cone.rayCount; i += 1) {
    assert.ok(cone.rayLengths[i]! < cone.sampleCount, "ray stopped at the boundary");
    assert.ok(cone.rayLengths[i]! > 0, "ray recorded at least the apex");
  }
});
