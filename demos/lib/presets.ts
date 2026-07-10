import type { LightconeSceneConfig } from "../scenes/lightcone.ts";

// The charged-blackholes lightcone surface demos, ported to the lightfall
// engine. Same physical scenarios (near-flat control, single, binary, triple,
// quad, and the future+past double cone), rebuilt as plain configs over the
// Majumdar–Papapetrou geodesic flow — no new physics, only placement.
//
// Coordinates are lightfall-native (unit scale: an m = 1 hole has a
// photon-sphere ~1 unit across), not a decimal copy of the originals; the point
// is the same causal structure for side-by-side evaluation.

// renderZero — a nearly massless hole: the near-Minkowski control. The cone is
// an almost-perfect straight cone, the baseline every lensed one deforms from.
export const NEAR_FLAT: LightconeSceneConfig = {
  label: "Near-flat control — light cone of a nearly massless hole (m = 0.02)",
  holes: [{ mass: 0.02, x: 0, y: 0 }],
};

// renderOne — the classic single lensed light cone (m = 1).
export const SINGLE: LightconeSceneConfig = {
  label: "Light cone near a Majumdar–Papapetrou black hole (m = 1)",
  holes: [{ mass: 1, x: 0, y: 0 }],
};

// renderTwo — a binary: two equal holes side by side, their shadows merging.
export const BINARY: LightconeSceneConfig = {
  label: "Light cone in a binary black hole (m = 1, 1)",
  holes: [
    { mass: 1, x: -1.3, y: 0 },
    { mass: 1, x: 1.3, y: 0 },
  ],
  defaults: { lambdaMax: 14 },
};

// renderThree — three holes (m = 1, 1, 2), an asymmetric lens.
export const TRIPLE: LightconeSceneConfig = {
  label: "Light cone in a triple black hole (m = 1, 1, 2)",
  holes: [
    { mass: 1, x: -1.6, y: 0.4 },
    { mass: 1, x: 1.6, y: 0.4 },
    { mass: 2, x: 0, y: -1.4 },
  ],
  defaults: { lambdaMax: 14 },
  // Right wall a little closer in for this composition.
  sideWallMargin: 0.24,
};

// renderFour — a quad: four holes (m = 1, 1, 2, 4).
export const QUAD: LightconeSceneConfig = {
  label: "Light cone in a quad black hole system (m = 1, 1, 2, 4)",
  holes: [
    { mass: 1, x: -1.8, y: 0.8 },
    { mass: 1, x: 1.4, y: 0.9 },
    { mass: 2, x: -1.1, y: -1.4 },
    { mass: 4, x: 1.9, y: -1.2 },
  ],
  defaults: { lambdaMax: 16 },
};

// renderDoubleOne — the full future+past light cone of an event near a single
// hole: gold rises, orange falls, both lensed by the same throat.
export const DOUBLE: LightconeSceneConfig = {
  label: "Double light cone (future + past) near a black hole (m = 1)",
  holes: [{ mass: 1, x: 0, y: 0 }],
  mode: "double",
};

// The gallery, in the order the landing page lists them.
export const DEMOS: { slug: string; title: string; config: LightconeSceneConfig }[] = [
  { slug: "near-flat", title: "Near-flat control", config: NEAR_FLAT },
  { slug: "single", title: "Single hole", config: SINGLE },
  { slug: "binary", title: "Binary", config: BINARY },
  { slug: "triple", title: "Triple", config: TRIPLE },
  { slug: "quad", title: "Quad", config: QUAD },
  { slug: "double", title: "Double cone (future + past)", config: DOUBLE },
];
