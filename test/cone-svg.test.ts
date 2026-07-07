import { test } from "node:test";
import assert from "node:assert/strict";

import { majumdarPapapetrou, Event } from "../src/spacetime/index.ts";
import { lightCone, uniformDirections } from "../src/lightcone/index.ts";
import { coneToSvg } from "../src/render/index.ts";

test("coneToSvg emits a well-formed SVG: one polyline per drawable ray + markers", () => {
  const holes = [{ x: 0, y: 0 }];
  const M = majumdarPapapetrou([{ mass: 1, x: 0, y: 0 }]);
  const cone = lightCone(M, Event.of(0, 0, -6), {
    directions: uniformDirections(40),
    samples: 60,
    step: 0.1,
    maxRadius: 14,
  });

  const svg = coneToSvg(cone, { width: 400, holes: holes.map((h) => ({ ...h, radius: 0.3 })) });

  assert.ok(svg.startsWith("<svg"), "starts with <svg");
  assert.ok(svg.trimEnd().endsWith("</svg>"), "ends with </svg>");
  assert.match(svg, /width="400"/, "honors the requested width");

  const polylines = svg.match(/<polyline/g)?.length ?? 0;
  let drawableRays = 0;
  for (let i = 0; i < cone.rayCount; i += 1) {
    if (cone.rayLengths[i]! >= 2) drawableRays += 1;
  }
  assert.equal(polylines, drawableRays, "one polyline per ray with ≥ 2 samples");

  // one circle for the hole + one for the apex
  const circles = svg.match(/<circle/g)?.length ?? 0;
  assert.equal(circles, 2, "hole marker + apex marker");

  // all coordinates finite (no NaN leaking into the picture)
  assert.ok(!/NaN/.test(svg), "no NaN coordinates");
});
