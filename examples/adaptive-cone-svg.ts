// Uniform vs. adaptive angular sampling, side by side, at a comparable ray
// budget. The adaptive cone spends its rays on the lensed sector and the
// caustics; the uniform one wastes them on the smooth far field.
//
// Run: node examples/adaptive-cone-svg.ts  → uniform.svg, adaptive.svg

import { writeFileSync } from "node:fs";
import { majumdarPapapetrou, Event } from "../src/spacetime/index.ts";
import {
  lightCone,
  adaptiveLightCone,
  uniformDirections,
  absorbedNear,
} from "../src/lightcone/index.ts";
import { coneToSvg } from "../src/render/index.ts";

const holes = [{ mass: 1, x: 0, y: 0 }];
const M = majumdarPapapetrou(holes);
const apex = Event.of(0, 0, -6);
const shared = { samples: 160, step: 0.07, maxRadius: 13, terminate: absorbedNear(holes, 0.3) };
const svgOpts = { width: 820, holes: holes.map((h) => ({ x: h.x, y: h.y, radius: 0.3 })) };

const { cone: adaptive, report } = adaptiveLightCone(M, apex, {
  ...shared,
  initialRays: 24,
  sagTol: 0.05, // world units — chord deviation (lensed folds)
  edgeTol: 0.2, // world units — even sampling density
  maxRays: 4000,
});
writeFileSync("adaptive.svg", coneToSvg(adaptive, svgOpts));

// Match the uniform ray count to the adaptive one for a fair comparison.
const uniform = lightCone(M, apex, { ...shared, directions: uniformDirections(adaptive.rayCount) });
writeFileSync("uniform.svg", coneToSvg(uniform, svgOpts));

console.log(`adaptive: ${adaptive.rayCount} rays (converged=${report.converged})`);
console.log(`uniform:  ${uniform.rayCount} rays (same budget, evenly spread)`);
console.log("open uniform.svg vs adaptive.svg");
