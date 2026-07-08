// The caustic curve of a lensed light cone, drawn over the adaptively-sampled
// ray tracks. The bright white curve is where the congruence folds — the cusps
// of the black-hole lens.
//
// Caustics here are a STRONG-lensing feature and razor-thin, so this uses a
// heavy hole, a long trace, a dense seed ring, and fine sampling. A weak or
// on-axis single lens has only a degenerate point caustic and shows nothing —
// which is physically correct (see docs/plans/adaptive-angular-sampling.md
// §Phase B and the caustics test).
//
// Run: node examples/caustics-svg.ts  → caustics.svg

import { writeFileSync } from "node:fs";
import { majumdarPapapetrou, Event } from "../src/spacetime/index.ts";
import { adaptiveLightCone, absorbedNear, causticSegments } from "../src/lightcone/index.ts";
import { coneToSvg } from "../src/render/index.ts";

const holes = [{ mass: 5, x: 0, y: 0 }];
const M = majumdarPapapetrou(holes);
const apex = Event.of(0, 0, -6);

const { cone } = adaptiveLightCone(M, apex, {
  samples: 1200,
  step: 0.035,
  maxRadius: 40,
  terminate: absorbedNear(holes, 0.12),
  initialRays: 64,
  sagTol: 0.04, // world units — tight, to catch the razor-thin caustic folds
  edgeTol: 0.4, // world units — element size over the long trace
  maxRays: 25000,
});

const caustics = causticSegments(cone);
const svg = coneToSvg(cone, {
  width: 820,
  holes: holes.map((h) => ({ x: h.x, y: h.y, radius: 0.12 })),
  caustics,
});
writeFileSync("caustics.svg", svg);
console.log(`${cone.rayCount} rays, ${caustics.length / 6} caustic segments → caustics.svg`);
