// The path-traced studio viewer. Owns a Studio (renderer + progressive path
// tracer) and a tabbed control panel, and drives a LightconeScene model. A saved
// "view" — the entire scene state (holes, observer, embedding, tracing) plus the
// presentation (camera, render size, environment, key light) — is persisted to
// localStorage per demo, so once you compose a shot and hit Save it becomes the
// default on reload. Every demo page is `mountStudio(PRESET)`.

import {
  LightconeScene,
  type Hole,
  type LightconeSceneConfig,
  type LightconeState,
} from "../scenes/lightcone.ts";
import {
  Studio,
  Panel,
  ENV_PRESETS,
  type EnvPresetName,
  type KeyLight,
  type SliderHandle,
} from "./studio/index.ts";
import type { RedshiftAnchor } from "../../src/render/three/index.ts";

const PAGE_STYLE = `
  html, body { margin: 0; height: 100%; overflow: hidden; background: #08080c;
    font-family: system-ui, sans-serif; }
  #studio-canvas { display: block; }
`;

const ASPECTS: Record<string, number | null> = {
  "free": null,
  "16:9": 16 / 9,
  "3:2": 3 / 2,
  "4:3": 4 / 3,
  "1:1": 1,
};

// Ray-budget slider (0–100) maps log-uniformly onto [MIN, MAX] rays, so the top
// end reaches hero-render densities (slow to trace, but available on demand).
const MIN_BUDGET = 600;
const MAX_BUDGET = 60000;
const detailToBudget = (d: number): number =>
  Math.round(MIN_BUDGET * 10 ** ((d / 100) * Math.log10(MAX_BUDGET / MIN_BUDGET)));
const budgetToDetail = (b: number): number =>
  Math.round((Math.log10(b / MIN_BUDGET) / Math.log10(MAX_BUDGET / MIN_BUDGET)) * 100);

const DEG = Math.PI / 180;

// The persisted composition for one demo: the whole scene plus its framing.
interface SavedView {
  state: LightconeState;
  camera: { position: [number, number, number]; target: [number, number, number] };
  aspect: string;
  longEdge: number;
  env: EnvPresetName;
  light: KeyLight;
}

export function mountStudio(config: LightconeSceneConfig): void {
  const style = document.createElement("style");
  style.textContent = PAGE_STYLE;
  document.head.appendChild(style);

  const studio = new Studio({ environment: "light" });
  if (config.sideWallMargin !== undefined) studio.sideMargin = config.sideWallMargin;

  const scene = new LightconeScene(config, {
    onGeometry: () => { studio.frameStudio(); studio.contentChanged(); },
    onMaterials: () => studio.materialsChanged(),
  });
  scene.group.rotation.z = -Math.PI / 2; // print reads time-horizontal
  studio.scene.add(scene.group);
  document.title = `lightfall — ${scene.label}`;
  studio.frameStudio();
  studio.contentChanged();

  const viewKey = `lightfall:view:${scene.label}`;

  // ---- coalesced state edits ----------------------------------------------
  const holesDraft: Hole[] = scene.holes.map((h) => ({ ...h }));
  const observerDraft = { ...scene.state.observer };
  const pending: Partial<LightconeState> = {};
  let raf = 0;
  let onResult: ((r: { rays: number; worstGap: number }) => void) | null = null;
  const flush = (): void => {
    raf = 0;
    const result = scene.update(pending);
    for (const k of Object.keys(pending)) delete (pending as Record<string, unknown>)[k];
    onResult?.(result);
  };
  const queue = (patch: Partial<LightconeState>): void => {
    Object.assign(pending, patch);
    if (!raf) raf = requestAnimationFrame(flush);
  };

  const panel = new Panel(scene.label);

  // ---- render tab ----------------------------------------------------------
  const render = panel.tab("render");
  render.custom(`<a class="link" href="/">← all demos</a>`);
  const samplesLabel = render.label("samples", "—");
  render.toggle("path trace", false, (on) => {
    studio.mode = on ? "trace" : "live";
    if (!on) samplesLabel.set("—");
  });
  studio.onSample = (n) => samplesLabel.set(String(n));
  render.section("surface");
  const redshiftToggle = render.toggle("redshift", scene.state.colorMode === "redshift", (on) => {
    scene.update({ colorMode: on ? "redshift" : "solid" });
  });
  const tubeToggle = render.toggle("boundary tube", scene.state.showTube, (on) => {
    scene.update({ showTube: on });
  });
  const raysToggle = render.toggle("traced rays", scene.state.showRays, (on) => {
    scene.update({ showRays: on });
  });
  render.section("redshift");
  const redshiftDraft = { ...scene.state.redshift };
  const rsScale = render.slider("scale", { min: 0.3, max: 4, step: 0.05, value: redshiftDraft.scale, format: (v) => v.toFixed(2) }, (v) => {
    redshiftDraft.scale = v; queue({ redshift: { ...redshiftDraft } });
  });
  const rsExag = render.slider("exaggeration", { min: 0.2, max: 3, step: 0.05, value: redshiftDraft.exaggeration, format: (v) => v.toFixed(2) }, (v) => {
    redshiftDraft.exaggeration = v; queue({ redshift: { ...redshiftDraft } });
  });
  const rsAnchor = render.dropdown("anchor", [
    { value: "edge", label: "per-ray (history)" },
    { value: "depth", label: "by depth (smooth)" },
    { value: "infinity", label: "from infinity" },
  ], redshiftDraft.anchor, (v) => {
    redshiftDraft.anchor = v as RedshiftAnchor; queue({ redshift: { ...redshiftDraft } });
  });
  render.section("quality");
  const raysLabel = render.label("rays", String(scene.result.rays));
  const budgetSlider = render.slider("ray budget", { min: 0, max: 100, step: 1, value: budgetToDetail(scene.state.rayBudget) }, (v) => {
    queue({ rayBudget: detailToBudget(v) });
  });

  // ---- geometry tab --------------------------------------------------------
  const geo = panel.tab("geometry");
  const gapLabel = geo.label("worst gap", scene.result.worstGap.toFixed(1));
  onResult = (r) => { raysLabel.set(String(r.rays)); gapLabel.set(r.worstGap.toFixed(1)); };
  geo.section("embedding");
  const stretchSlider = geo.slider("time stretch", { min: 0.05, max: 2.5, step: 0.01, value: scene.state.timeScale, format: (v) => v.toFixed(2) }, (v) => {
    queue({ timeScale: v });
  });
  geo.section("observer");
  const obsXSlider = geo.slider("obs x", { min: -16, max: 16, step: 0.1, value: observerDraft.x, format: (v) => v.toFixed(1) }, (v) => {
    observerDraft.x = v; queue({ observer: { ...observerDraft } });
  });
  const obsYSlider = geo.slider("obs y", { min: -28, max: -1, step: 0.1, value: observerDraft.y, format: (v) => v.toFixed(1) }, (v) => {
    observerDraft.y = v; queue({ observer: { ...observerDraft } });
  });
  const holeCtl: { mass: SliderHandle; x: SliderHandle; y: SliderHandle }[] = [];
  scene.holes.forEach((_, i) => {
    geo.section(`hole ${i + 1}`);
    const mass = geo.slider("mass", { min: 0, max: 5, step: 0.05, value: holesDraft[i]!.mass, format: (v) => v.toFixed(2) }, (v) => {
      holesDraft[i]!.mass = v; queue({ holes: holesDraft.map((h) => ({ ...h })) });
    });
    const x = geo.slider("x", { min: -8, max: 8, step: 0.05, value: holesDraft[i]!.x, format: (v) => v.toFixed(2) }, (v) => {
      holesDraft[i]!.x = v; queue({ holes: holesDraft.map((h) => ({ ...h })) });
    });
    const y = geo.slider("y", { min: -8, max: 8, step: 0.05, value: holesDraft[i]!.y, format: (v) => v.toFixed(2) }, (v) => {
      holesDraft[i]!.y = v; queue({ holes: holesDraft.map((h) => ({ ...h })) });
    });
    holeCtl.push({ mass, x, y });
  });
  geo.section("tracing");
  const lenSlider = geo.slider("geodesic len", { min: 4, max: 28, step: 0.5, value: scene.state.lambdaMax }, (v) => {
    queue({ lambdaMax: v });
  });

  // ---- studio tab (environment, lighting, saved view) ----------------------
  const st = panel.tab("studio");
  const envDrop = st.dropdown("environment", ENV_PRESETS, "light", (v) => {
    studio.setEnvironment(v as EnvPresetName);
    lightIntensity.set(studio.keyLight.intensity);
  });
  st.section("key light");
  const k = studio.keyLight;
  const lightAz = st.slider("azimuth", { min: -180, max: 180, step: 1, value: Math.round(k.azimuth / DEG) }, (v) => {
    studio.setKeyLight({ azimuth: v * DEG });
  });
  const lightEl = st.slider("elevation", { min: 0, max: 89, step: 1, value: Math.round(k.elevation / DEG) }, (v) => {
    studio.setKeyLight({ elevation: v * DEG });
  });
  const lightDist = st.slider("distance", { min: 1, max: 6, step: 0.05, value: k.distance, format: (v) => v.toFixed(2) }, (v) => {
    studio.setKeyLight({ distance: v });
  });
  const lightIntensity = st.slider("intensity", { min: 0, max: 8, step: 0.05, value: k.intensity, format: (v) => v.toFixed(2) }, (v) => {
    studio.setKeyLight({ intensity: v });
  });
  st.section("saved view");
  const viewStatus = st.label("saved", "—");
  st.button("save view", () => {
    saveView();
    viewStatus.set("✓ this reload's default");
  }, true);
  st.button("reset view", () => {
    localStorage.removeItem(viewKey);
    studio.clearOutputSize();
    studio.setAspect(null);
    studio.frameCamera();
    viewStatus.set("cleared");
  });

  // ---- export tab ----------------------------------------------------------
  const exp = panel.tab("export");
  const aspect = exp.dropdown("aspect", Object.keys(ASPECTS), "free", (v) => {
    if (!studio.outputActive) studio.setAspect(ASPECTS[v] ?? null);
  });
  const longEdge = exp.number("long edge px", { value: 1440, min: 64, max: 8192, step: 1 }, () => {});
  const dims = (): [number, number] => {
    const a = ASPECTS[aspect.value] ?? window.innerWidth / window.innerHeight;
    const long = Math.max(64, Math.round(longEdge.value));
    return a >= 1 ? [long, Math.round(long / a)] : [Math.round(long * a), long];
  };
  exp.button("render at size", () => {
    const [w, h] = dims();
    studio.setOutputSize(w, h);
  });
  exp.button("fit screen", () => studio.clearOutputSize());
  exp.button("save PNG", () => {
    const [w, h] = studio.pixelSize;
    const slug = scene.label.replace(/\s+/g, "-").toLowerCase();
    studio.saveScreenshot(`lightfall-${slug}-${w}x${h}.png`);
  }, true);

  // ---- persistence ---------------------------------------------------------
  function saveView(): void {
    const view: SavedView = {
      state: JSON.parse(JSON.stringify(scene.state)) as LightconeState,
      camera: {
        position: studio.camera.position.toArray() as [number, number, number],
        target: studio.controls.target.toArray() as [number, number, number],
      },
      aspect: aspect.value,
      longEdge: Math.round(longEdge.value),
      env: envDrop.value as EnvPresetName,
      light: { ...studio.keyLight },
    };
    localStorage.setItem(viewKey, JSON.stringify(view));
  }

  // Push a restored scene state into every geometry/render control's display.
  function syncControls(s: LightconeState): void {
    redshiftToggle.set(s.colorMode === "redshift");
    tubeToggle.set(s.showTube);
    raysToggle.set(s.showRays);
    Object.assign(redshiftDraft, s.redshift);
    rsScale.set(s.redshift.scale);
    rsExag.set(s.redshift.exaggeration);
    rsAnchor.set(s.redshift.anchor);
    budgetSlider.set(budgetToDetail(s.rayBudget));
    stretchSlider.set(s.timeScale);
    obsXSlider.set(s.observer.x);
    obsYSlider.set(s.observer.y);
    lenSlider.set(s.lambdaMax);
    s.holes.forEach((h, i) => {
      holeCtl[i]?.mass.set(h.mass);
      holeCtl[i]?.x.set(h.x);
      holeCtl[i]?.y.set(h.y);
    });
  }

  function loadView(): boolean {
    const raw = localStorage.getItem(viewKey);
    if (!raw) return false;
    try {
      const v = JSON.parse(raw) as SavedView;
      // Restore the whole scene (holes, observer, embedding, tracing) — but only
      // if the hole count matches this preset, so a saved view can't corrupt a
      // different configuration.
      if (v.state && v.state.holes?.length === scene.holes.length) {
        Object.assign(holesDraft, v.state.holes.map((h) => ({ ...h })));
        Object.assign(observerDraft, v.state.observer);
        const result = scene.update(v.state);
        onResult?.(result);
        syncControls(v.state);
      }
      if (v.env && v.env !== "light") {
        envDrop.set(v.env);
        studio.setEnvironment(v.env);
      }
      if (v.light) {
        Object.assign(studio.keyLight, v.light);
        studio.setKeyLight({});
        lightAz.set(Math.round(v.light.azimuth / DEG));
        lightEl.set(Math.round(v.light.elevation / DEG));
        lightDist.set(v.light.distance);
        lightIntensity.set(v.light.intensity);
      }
      if (v.aspect) { aspect.set(v.aspect); studio.setAspect(ASPECTS[v.aspect] ?? null); }
      if (v.longEdge) longEdge.set(v.longEdge);
      if (v.camera) studio.setCameraPose(v.camera.position, v.camera.target);
      return true;
    } catch {
      return false;
    }
  }

  // Restore the saved composition, or frame from scratch.
  if (loadView()) viewStatus.set("restored");
  else studio.frameCamera();
}
