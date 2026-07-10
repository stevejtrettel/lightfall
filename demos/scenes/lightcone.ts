import { Group, Mesh } from "three";

import { majumdarPapapetrou, Event } from "../../src/spacetime/index.ts";
import {
  buildCone,
  COARSE_CONE,
  REFINE_CONE,
  absorbedWithin,
  type ConeQuality,
  type LightCone,
} from "../../src/lightcone/index.ts";
import {
  ConeMesh,
  ConeRays,
  EndTube,
  worldtube,
  timeUp,
  type ConeColorMode,
  type RedshiftAnchor,
} from "../../src/render/three/index.ts";

// A spatial black hole: mass and (x, y). The metric, the terminator, and the
// worldtube all consume this shape.
export interface Hole {
  mass: number;
  x: number;
  y: number;
}

// A cut/horizon circle in the spatial plane, sized per hole.
export interface Horizon {
  x: number;
  y: number;
  radius: number;
}

// The full, editable state of a lightcone scene — the single source of truth.
// Everything the render shows is a pure function of this. `update()` classifies
// which fields changed and does the cheapest sufficient recompute.
export interface LightconeState {
  // The metric: the holes and where the observer sits (apex at t = 0).
  holes: Hole[];
  observer: { x: number; y: number };
  // Embedding: vertical stretch of the time axis (cheap — no re-trace).
  timeScale: number;
  // Tracing: how far the null geodesics run and the adaptive ray budget.
  lambdaMax: number;
  rayBudget: number;
  quality: "coarse" | "refine";
  // Appearance.
  colorMode: ConeColorMode;
  showTube: boolean;
  showRays: boolean;
  // Redshift colouring: saturation scale, exaggeration, and where "yellow" is
  // anchored (each ray's edge, or a fixed far-field reference).
  redshift: { scale: number; exaggeration: number; anchor: RedshiftAnchor };
}

// A demo scene config: the fixed scenario (holes, sheets, framing) plus initial
// state overrides. The engine is identical across demos — only this differs.
export interface LightconeSceneConfig {
  label: string;
  holes: readonly Hole[];
  mode?: "future" | "double";
  // Base horizon radius at mass 1; per-hole radius scales as base·√mass.
  stopRadius?: number;
  timeScale?: number;
  defaults?: Partial<LightconeState>;
  camera?: {
    position: [number, number, number];
    target?: [number, number, number];
  };
  // How far the studio's right (side) wall sits behind the cone (fraction of
  // radius); presentation only. Defaults to 0.35.
  sideWallMargin?: number;
}

export interface BuildResult {
  rays: number;
  worstGap: number;
}

export interface SceneCallbacks {
  // The scene graph changed (geometry rebuilt / objects toggled): rebuild BVH.
  onGeometry?: () => void;
  // Only materials changed (colour mode).
  onMaterials?: () => void;
}

// The two sheet colours: future rises in gold, past falls in orange.
const FUTURE_COLOR = 0xf5c542;
const PAST_COLOR = 0xff770f;

// A deep angular floor turns refinement into a pure budget-driven, worst-first
// fill (see the notes in quality.ts / the adaptive sampler).
const ANGLE_FLOOR = (2 * Math.PI) / 16777216;

// Smallest visible horizon, so a nearly massless hole still shows a throat.
const MIN_HORIZON = 0.05;

// Geometry is baked at unit time scale; vertical stretch is applied as a
// group Y-scale, so changing it never rebuilds geometry.
const REF_EMBEDDING = timeUp(1);

const DEFAULT_STATE: LightconeState = {
  holes: [],
  observer: { x: 0, y: -5 },
  // Time-dominant so the (horizontally-drawn) cone reads elongated like the
  // charged-blackholes reference rather than squat. Stretch is distortion-free.
  timeScale: 0.9,
  lambdaMax: 12,
  rayBudget: 1000,
  quality: "coarse",
  colorMode: "solid",
  showTube: true,
  showRays: false,
  redshift: { scale: 1.5, exaggeration: 1, anchor: "depth" },
};

// Per-hole horizon radius: scales with mass so heavier holes read as bigger
// throats, with a floor so the lightest never vanishes.
export function horizonRadius(mass: number, base: number): number {
  return Math.max(base * Math.sqrt(Math.max(mass, 0)), MIN_HORIZON);
}

const LEVEL = { material: 1, visibility: 2, stretch: 3, recolor: 4, trace: 5 } as const;

// Which recompute level a state key demands. Vertical stretch is only a Y-scale
// of already-built geometry (never rebuilds); a redshift tweak rebuilds geometry
// from the cached cones (recolours, no re-trace); metric/tracing edits re-trace.
function levelOf(key: keyof LightconeState): number {
  switch (key) {
    case "colorMode": return LEVEL.material;
    case "showTube":
    case "showRays": return LEVEL.visibility;
    case "timeScale": return LEVEL.stretch;
    case "redshift": return LEVEL.recolor;
    default: return LEVEL.trace; // holes, observer, lambdaMax, rayBudget, quality
  }
}

// The lightcone as a live, editable model. Owns the traced cones and all the
// three.js objects (surface, rim tube, worldtubes, rays) under one Group. Edits
// go through `update(patch)`, which re-traces geodesics only when the metric or
// tracing parameters change; a vertical-stretch edit merely re-embeds the cached
// cones, and colour/visibility edits are cheaper still.
export class LightconeScene {
  readonly group = new Group();
  readonly state: LightconeState;

  private readonly config: LightconeSceneConfig;
  private readonly stopBase: number;
  private readonly energies: (number | undefined)[];
  private readonly sheetColors: number[];
  private readonly callbacks: SceneCallbacks;

  private cones: LightCone[] = [];
  private meshes: ConeMesh[] = [];
  private endTubes: EndTube[] = [];
  private worldtubes: Mesh[] = [];
  private rays: ConeRays[] = [];
  private report: BuildResult = { rays: 0, worstGap: 0 };
  private target: [number, number, number] = [0, 4, -3];
  // Vertical mid-time of the content in reference (unstretched) coordinates.
  private centerT = 0;

  constructor(config: LightconeSceneConfig, callbacks: SceneCallbacks = {}) {
    this.config = config;
    this.callbacks = callbacks;
    this.stopBase = config.stopRadius ?? 0.3;
    const isDouble = config.mode === "double";
    this.energies = isDouble ? [undefined, -1] : [undefined];
    this.sheetColors = isDouble ? [FUTURE_COLOR, PAST_COLOR] : [FUTURE_COLOR];

    this.state = {
      ...DEFAULT_STATE,
      ...config.defaults,
      timeScale: config.timeScale ?? config.defaults?.timeScale ?? DEFAULT_STATE.timeScale,
      observer: { ...DEFAULT_STATE.observer, ...config.defaults?.observer },
      holes: config.holes.map((h) => ({ ...h })),
    };

    this.trace();
  }

  // ---- editing -------------------------------------------------------------

  // Merge a patch into the state and recompute at the cheapest sufficient level.
  update(patch: Partial<LightconeState>): BuildResult {
    let level = 0;
    for (const key of Object.keys(patch) as (keyof LightconeState)[]) {
      level = Math.max(level, levelOf(key));
    }
    Object.assign(this.state, patch);

    if (level >= LEVEL.trace) this.trace();
    else if (level >= LEVEL.recolor) this.buildGeometry();
    else if (level >= LEVEL.stretch) this.applyStretch();
    else if (level >= LEVEL.visibility) this.applyVisibility();
    else if (level >= LEVEL.material) this.applyMaterials();

    if (level >= LEVEL.visibility) this.callbacks.onGeometry?.();
    else if (level >= LEVEL.material) this.callbacks.onMaterials?.();
    return this.report;
  }

  // Convenience: edit one hole (mass/position) → a metric change (re-trace).
  updateHole(index: number, patch: Partial<Hole>): BuildResult {
    const holes = this.state.holes.map((h, i) => (i === index ? { ...h, ...patch } : h));
    return this.update({ holes });
  }

  // ---- readouts ------------------------------------------------------------

  get holes(): readonly Hole[] { return this.state.holes; }
  get result(): BuildResult { return this.report; }
  get cameraTarget(): [number, number, number] { return this.target; }
  get label(): string { return this.config.label; }
  get camera(): LightconeSceneConfig["camera"] { return this.config.camera; }

  // ---- recompute levels ----------------------------------------------------

  private horizons(): Horizon[] {
    return this.state.holes.map((h) => ({
      x: h.x,
      y: h.y,
      radius: horizonRadius(h.mass, this.stopBase),
    }));
  }

  // Re-trace the null congruence(s) from the current metric/observer, then embed.
  private trace(): void {
    const manifold = majumdarPapapetrou(this.state.holes);
    const apex = Event.of(0, this.state.observer.x, this.state.observer.y);
    const base: ConeQuality = this.state.quality === "refine" ? REFINE_CONE : COARSE_CONE;
    const tuned: ConeQuality = {
      ...base,
      maxRays: Math.max(this.state.rayBudget, base.maxRays),
      minAngle: ANGLE_FLOOR,
    };
    const absorb = this.horizons().map((h) => ({ ...h, radius: h.radius * 0.45 }));

    this.cones = [];
    let totalRays = 0;
    let worstGap = 0;
    for (let s = 0; s < this.energies.length; s += 1) {
      const { cone, report } = buildCone(manifold, apex, tuned, {
        lambdaMax: this.state.lambdaMax,
        terminate: absorbedWithin(absorb),
        ...(this.energies[s] !== undefined ? { energy: this.energies[s]! } : {}),
      });
      this.cones.push(cone);
      totalRays += cone.rayCount;
      worstGap = Math.max(worstGap, report.worstGap);
    }
    this.report = { rays: totalRays, worstGap };
    this.buildGeometry();
  }

  // Rebuild every three.js object from the cached cones with the current
  // embedding (used by re-trace and by a bare vertical-stretch change).
  private buildGeometry(): void {
    this.disposeGeometry();
    const embedding = REF_EMBEDDING;
    const horizons = this.horizons();
    const tubeRadius = this.stopBase * 0.15;

    for (let s = 0; s < this.cones.length; s += 1) {
      const cone = this.cones[s]!;
      const mesh = new ConeMesh(cone, {
        embedding,
        color: this.sheetColors[s]!,
        colorMode: this.state.colorMode,
        redshift: this.state.redshift,
        trim: { centers: horizons },
        tear: false,
      });
      this.group.add(mesh);
      this.meshes.push(mesh);

      const endTube = new EndTube(mesh.geometry, {
        radius: tubeRadius,
        cut: { centers: horizons },
        // Rim reads a touch darker than the surface it borders — a subtle outline.
        darken: 0.82,
      });
      endTube.visible = this.state.showTube;
      this.group.add(endTube);
      this.endTubes.push(endTube);
    }

    // Tube span from the visible (outside-the-cut) extent across every sheet.
    let tMax = 0;
    let tMin = 0;
    for (const cone of this.cones) {
      for (let i = 0; i < cone.rayCount; i += 1) {
        for (let j = 0; j < cone.rayLengths[i]!; j += 1) {
          const x = cone.coord(i, j, 1);
          const y = cone.coord(i, j, 2);
          let outside = true;
          for (const h of horizons) {
            if (Math.hypot(x - h.x, y - h.y) < h.radius) { outside = false; break; }
          }
          if (outside) {
            const t = cone.coord(i, j, 0);
            if (t > tMax) tMax = t;
            if (t < tMin) tMin = t;
          }
        }
      }
    }
    // Run the horizon pillars far past the cone in both time directions, so in
    // the print they pierce the cyclorama wall on one side and leave the frame
    // on the other — long black rods, as in the reference. The extension is
    // flagged `noBound` so it never inflates the camera / cyclorama framing.
    const pad = (tMax - tMin) * 2 + 60;
    for (let i = 0; i < this.state.holes.length; i += 1) {
      const wt = worldtube(this.state.holes[i]!, {
        embedding,
        tMin: tMin - pad,
        tMax: tMax + pad,
        radius: horizons[i]!.radius,
      });
      wt.userData.noBound = true;
      this.group.add(wt);
      this.worldtubes.push(wt);
    }

    this.syncRays(embedding, horizons);
    this.centerT = (tMax + tMin) / 2;
    this.applyStretch();
  }

  // Vertical stretch: a pure Y-scale of the baked geometry (instant — no
  // rebuild). Recomputes the framing target for the new stretch.
  private applyStretch(): void {
    this.group.scale.y = this.state.timeScale;
    this.target = [0, this.centerT * this.state.timeScale * 0.9, -3];
  }

  private syncRays(
    embedding = REF_EMBEDDING,
    horizons = this.horizons(),
  ): void {
    for (const r of this.rays) {
      this.group.remove(r);
      r.dispose();
    }
    this.rays = [];
    if (!this.state.showRays) return;
    for (const cone of this.cones) {
      const r = new ConeRays(cone, { embedding, centers: horizons });
      this.group.add(r);
      this.rays.push(r);
    }
  }

  private applyMaterials(): void {
    for (const mesh of this.meshes) mesh.setColorMode(this.state.colorMode);
  }

  private applyVisibility(): void {
    for (const t of this.endTubes) t.visible = this.state.showTube;
    this.syncRays();
  }

  private disposeGeometry(): void {
    for (const m of this.meshes) { this.group.remove(m); m.dispose(); }
    for (const t of this.endTubes) { this.group.remove(t); t.dispose(); }
    for (const r of this.rays) { this.group.remove(r); r.dispose(); }
    for (const w of this.worldtubes) {
      this.group.remove(w);
      w.geometry.dispose();
      (w.material as { dispose(): void }).dispose();
    }
    this.meshes = [];
    this.endTubes = [];
    this.rays = [];
    this.worldtubes = [];
  }

  dispose(): void {
    this.disposeGeometry();
  }
}
