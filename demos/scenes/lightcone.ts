import type { Scene } from "three";

import { majumdarPapapetrou, Event } from "../../src/spacetime/index.ts";
import { lightCone, uniformDirections, absorbedNear } from "../../src/lightcone/index.ts";
import { ConeMesh, worldtube, timeUp } from "../../src/render/three/index.ts";

export interface SceneResult {
  label: string;
  camera: { position: [number, number, number]; target: [number, number, number] };
  cone: ConeMesh;
}

// The MVP scene: the lensed light cone of an event near a single Majumdar–
// Papapetrou black hole, rising in time, with the horizon worldtube.
export function runLightcone(scene: Scene): SceneResult {
  const holes = [{ mass: 1, x: 0, y: 0 }];
  const M = majumdarPapapetrou(holes);
  const apex = Event.of(0, 0, -5);

  const cone = lightCone(M, apex, {
    directions: uniformDirections(240),
    samples: 200,
    step: 0.06,
    maxRadius: 12,
    terminate: absorbedNear(holes, 0.35),
  });

  const embedding = timeUp(0.8);
  const mesh = new ConeMesh(cone, { embedding, color: 0xf5c542 });
  scene.add(mesh);

  let tMax = 0;
  for (let i = 0; i < cone.rayCount; i += 1) {
    tMax = Math.max(tMax, cone.coord(i, cone.rayLengths[i]! - 1, 0));
  }
  for (const h of holes) {
    scene.add(worldtube(h, { embedding, tMin: 0, tMax, radius: 0.35 }));
  }

  const midHeight = tMax * embedding.timeScale * 0.45;
  return {
    label: "Light cone near a Majumdar–Papapetrou black hole (m = 1)",
    camera: { position: [13, 9, 7], target: [0, midHeight, -3] },
    cone: mesh,
  };
}
