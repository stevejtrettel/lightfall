// Phase 4 checkpoint: compute a light cone once, read views off it.
// Flat spacetime → a perfectly circular wavefront (radius = t); a black hole
// → the same flash, lensed and Shapiro-delayed on the near side.
//
// Run: node examples/light-cone.ts

import { minkowski, majumdarPapapetrou, Event } from "../src/spacetime/index.ts";
import { lightCone, uniformDirections } from "../src/lightcone/index.ts";

function report(label: string, cone: ReturnType<typeof lightCone>, time: number, ax: number, ay: number) {
  const front = cone.wavefront(time);
  let rMin = Infinity;
  let rMax = 0;
  for (let k = 0; k < front.length; k += 3) {
    const r = Math.hypot(front[k + 1]! - ax, front[k + 2]! - ay);
    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
  }
  console.log(
    `${label.padEnd(28)} rays=${cone.rayCount} front-points=${String(front.length / 3).padStart(3)} ` +
      `wavefront r∈[${rMin.toFixed(3)}, ${rMax.toFixed(3)}]  spread=${(rMax - rMin).toExponential(2)}`,
  );
}

const dirs = uniformDirections(180);

const flat = lightCone(minkowski(), Event.of(0, 3, 0), { directions: dirs, samples: 80, step: 0.1 });
report("Minkowski (flat)", flat, 2.5, 3, 0);

const M = majumdarPapapetrou([{ mass: 1, x: 0, y: 0 }]);
const bh = lightCone(M, Event.of(0, 3, 0), { directions: dirs, samples: 120, step: 0.1, maxRadius: 40 });
report("Single black hole (m=1)", bh, 2.5, 3, 0);

const binary = majumdarPapapetrou([
  { mass: 1, x: -2, y: 0 },
  { mass: 1, x: 2, y: 0 },
]);
const bin = lightCone(binary, Event.of(0, 0, 5), { directions: dirs, samples: 120, step: 0.1, maxRadius: 40 });
report("Binary black holes", bin, 4.0, 0, 5);
