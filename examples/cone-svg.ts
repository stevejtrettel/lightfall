// Draw the spatial projection of a light cone as an SVG you can open — the
// lensing picture, before any Three.js. Ray tracks fan from the apex and bend
// around the holes; captured rays end at the throat.
//
// Run: node examples/cone-svg.ts   → writes cone-single.svg, cone-binary.svg

import { writeFileSync } from "node:fs";
import { majumdarPapapetrou, Event } from "../src/spacetime/index.ts";
import { lightCone, uniformDirections, absorbedNear } from "../src/lightcone/index.ts";
import { coneToSvg } from "../src/render/index.ts";

interface Hole {
  mass: number;
  x: number;
  y: number;
}

function render(file: string, holes: Hole[], apex: Event): void {
  const M = majumdarPapapetrou(holes);
  const cone = lightCone(M, apex, {
    directions: uniformDirections(220),
    samples: 180,
    step: 0.07,
    maxRadius: 14,
    terminate: absorbedNear(holes, 0.3),
  });

  let absorbed = 0;
  for (let i = 0; i < cone.rayCount; i += 1) {
    if (cone.rayLengths[i]! < cone.sampleCount) absorbed += 1;
  }

  const svg = coneToSvg(cone, {
    width: 820,
    holes: holes.map((h) => ({ x: h.x, y: h.y, radius: 0.3 })),
  });
  writeFileSync(file, svg);
  console.log(`wrote ${file}  —  ${cone.rayCount} rays, ${absorbed} captured/escaped`);
}

render("cone-single.svg", [{ mass: 1, x: 0, y: 0 }], Event.of(0, 0, -6));
render(
  "cone-binary.svg",
  [{ mass: 1, x: -2.5, y: 0 }, { mass: 1, x: 2.5, y: 0 }],
  Event.of(0, 0, -6),
);
console.log("open cone-single.svg / cone-binary.svg in a browser or editor preview");
