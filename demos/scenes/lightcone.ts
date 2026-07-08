import type { Mesh, Scene } from "three";

import { majumdarPapapetrou, Event } from "../../src/spacetime/index.ts";
import {
  buildCone,
  COARSE_CONE,
  absorbedNear,
  type ConeQuality,
  type LightCone,
} from "../../src/lightcone/index.ts";
import {
  ConeMesh,
  ConeRays,
  worldtube,
  timeUp,
  type ConeColorMode,
} from "../../src/render/three/index.ts";

// Live scene parameters, independent of quality: how far to trace the rays
// (affine length), how far the emitting observer sits from the hole, and the
// angular ray budget. Refinement is worst-first against the surface criteria
// (flatness, element size, shadow-edge fate), so raising the budget always spends
// the new rays on the widest-diverging neighbours first (the shadow edge, the
// strongly-lensed fans) — not uniformly.
export interface SceneParams {
  lambdaMax: number; // geodesic (affine) length
  observerDistance: number; // apex distance from the hole along −y
  rayBudget: number; // max angular rays; worst-first fills widest gaps first
}

export const DEFAULT_PARAMS: SceneParams = {
  lambdaMax: 12,
  observerDistance: 5,
  rayBudget: 1000,
};

// A deep angular floor turns refinement into a pure budget-driven, worst-first
// fill: with the preset's tight tolerances the heap never "converges", so every
// ray in the budget goes to the current widest gap. Shared by all builds.
//
// The floor is what caps how finely the photon-sphere shadow edge can be
// subdivided. At 2π/2²⁴ it's deep enough that the *budget* — not the floor —
// limits the worst gap there (measured: dropping from 2²⁰ to 2²⁴ takes the
// residual shadow-edge gap from ~1.2 to budget-controlled; integration accuracy
// is irrelevant, so plain rtol suffices). Deeper buys nothing the budget can't.
const ANGLE_FLOOR = (2 * Math.PI) / 16777216;

export interface SceneHandle {
  label: string;
  camera: { position: [number, number, number]; target: [number, number, number] };
  setColorMode(mode: ConeColorMode): void;
  // Toggle the traced-ray overlay (cheap: reuses the last built cone).
  setShowRays(show: boolean): void;
  // Rebuild at a new quality (coarse ↔ refine).
  rebuild(quality: ConeQuality): BuildResult;
  // Live scene knobs. Each rebuilds at the current quality.
  setParams(params: Partial<SceneParams>): BuildResult;
  params: SceneParams;
}

// What a rebuild reports back to the UI: the ray count and the widest remaining
// stretched-thin gap (world units; plateaus at the photon sphere).
export interface BuildResult {
  rays: number;
  worstGap: number;
}

// The MVP scene: the lensed light cone of an event near a single Majumdar–
// Papapetrou black hole, rising in time, with the horizon worldtube. Owns its
// scene objects so it can swap the cone between quality levels live.
export function runLightcone(scene: Scene): SceneHandle {
  const holes = [{ mass: 1, x: 0, y: 0 }];
  const M = majumdarPapapetrou(holes);
  // The surface is cut cleanly on `stopRadius` (the tube). Rays terminate a bit
  // inside it so the mesh has geometry straddling the cut.
  const stopRadius = 0.4;
  const embedding = timeUp(0.4);

  const params: SceneParams = { ...DEFAULT_PARAMS };
  let quality: ConeQuality = COARSE_CONE;

  let mesh: ConeMesh | undefined;
  let rays: ConeRays | undefined;
  let lastCone: LightCone | undefined;
  let tubes: Mesh[] = [];
  let colorMode: ConeColorMode = "solid";
  let showRays = false;
  let target: [number, number, number] = [0, 4, -3];

  // Add/remove the traced-ray overlay to match `showRays`, reusing the last
  // built cone so toggling it never recomputes geodesics.
  const syncRays = (): void => {
    if (rays) {
      scene.remove(rays);
      rays.dispose();
      rays = undefined;
    }
    if (showRays && lastCone) {
      rays = new ConeRays(lastCone, { embedding, clipRadius: stopRadius, centers: holes });
      scene.add(rays);
    }
  };

  const build = (): BuildResult => {
    if (mesh) {
      scene.remove(mesh);
      mesh.dispose();
    }
    for (const t of tubes) scene.remove(t);
    tubes = [];

    // Apex sits distance `observerDistance` from the hole along −y; rays are
    // traced for affine length `lambdaMax`.
    const apex = Event.of(0, 0, -params.observerDistance);
    const sceneOpts = {
      lambdaMax: params.lambdaMax,
      terminate: absorbedNear(holes, stopRadius * 0.45),
    };
    const tuned: ConeQuality = {
      ...quality,
      // The slider is the budget; worst-first spends it on the widest gaps. The
      // deep floor lets it keep subdividing the photon-sphere shadow edge (which
      // the old floor blocked, starving exactly the widest divergers).
      maxRays: params.rayBudget,
      minAngle: ANGLE_FLOOR,
    };
    const { cone, report } = buildCone(M, apex, tuned, sceneOpts);
    mesh = new ConeMesh(cone, {
      embedding,
      color: 0xf5c542,
      colorMode,
      // Cut the surface on the tube; keep the grid continuous so the cut is the
      // only near-hole boundary (rays run deep inside stopRadius, then every
      // straddling edge is backtracked to its exact intersection with the tube).
      // Tearing here instead would shred the surface into spikes at the cut.
      trim: { centers: holes, radius: stopRadius },
      tear: false,
    });
    scene.add(mesh);
    lastCone = cone;

    // The traced congruence, drawn out to the same tube cut as the surface, so
    // the overlay shows exactly the rays that meshed it — dense where covered,
    // fanned where stretched thin.
    syncRays();

    // Tube height from the visible (outside-the-cut) extent, so a deep-plunge
    // sample can't inflate it.
    let tMax = 0;
    for (let i = 0; i < cone.rayCount; i += 1) {
      for (let j = 0; j < cone.rayLengths[i]!; j += 1) {
        const x = cone.coord(i, j, 1);
        const y = cone.coord(i, j, 2);
        let outside = true;
        for (const h of holes) {
          if (Math.hypot(x - h.x, y - h.y) < stopRadius) {
            outside = false;
            break;
          }
        }
        if (outside) tMax = Math.max(tMax, cone.coord(i, j, 0));
      }
    }
    for (const h of holes) {
      const t = worldtube(h, { embedding, tMin: 0, tMax, radius: stopRadius });
      tubes.push(t);
      scene.add(t);
    }
    target = [0, tMax * embedding.timeScale * 0.45, -3];
    return { rays: cone.rayCount, worstGap: report.worstGap };
  };

  build();

  return {
    label: "Light cone near a Majumdar–Papapetrou black hole (m = 1)",
    camera: { position: [24, 16, 20], target },
    params,
    setColorMode(m) {
      colorMode = m;
      mesh?.setColorMode(m);
    },
    setShowRays(show) {
      showRays = show;
      syncRays();
    },
    rebuild(q) {
      quality = q;
      return build();
    },
    setParams(next) {
      Object.assign(params, next);
      // A structural change resets to coarse — refining a moved cone would block
      // on every drag; the user re-refines when they settle.
      quality = COARSE_CONE;
      return build();
    },
  };
}
