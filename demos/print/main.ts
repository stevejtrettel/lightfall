// A lean, standalone viewer built for OBJ export — no path-tracing Studio, just
// a WebGL renderer, orbit controls, and the three model pieces (surface, rim
// tube, black-hole rod) over the single-black-hole cone. The surface is cut
// exactly at the rod radius, so the exported mesh has a clean rod-shaped hole.
// Export writes one .obj with two objects: `o cone` (surface, plus the rim tube
// when enabled) and `o rods` (the horizon pillar).

import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Mesh,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { majumdarPapapetrou, Event } from "../../src/spacetime/index.ts";
import {
  buildCone,
  COARSE_CONE,
  absorbedWithin,
  type LightCone,
} from "../../src/lightcone/index.ts";
import {
  ConeMesh,
  EndTube,
  worldtube,
  timeUp,
  exportOBJ,
  downloadText,
} from "../../src/render/three/index.ts";

// ---- fixed scene: a single m = 1 black hole ------------------------------
const HOLE = { x: 0, y: 0, radius: 0.3 };
const OBSERVER = Event.of(0, 0, -5);
const LAMBDA_MAX = 12;
const ABSORB_RADIUS = HOLE.radius * 0.45; // rays traced to just inside the throat
const RIM_RADIUS = HOLE.radius * 0.15;
const RIM_DARKEN = 0.82;
const ANGLE_FLOOR = (2 * Math.PI) / 16777216;
const EMBEDDING = timeUp(1); // time = +Y (vertical rod), unit scale

const manifold = majumdarPapapetrou([{ mass: 1, x: HOLE.x, y: HOLE.y }]);

// ---- live state ----------------------------------------------------------
const state = {
  rodLength: 16, // total rod length in time units, centred on the cone
  rayBudget: 800,
  showTube: true,
};

// ---- renderer / scene ----------------------------------------------------
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new Scene();
scene.background = new Color(0x0a0a0f);
scene.add(new AmbientLight(0xffffff, 0.6));
const key = new DirectionalLight(0xffffff, 1.0);
key.position.set(6, 12, 8);
scene.add(key);
const fill = new DirectionalLight(0x88aaff, 0.4);
fill.position.set(-8, 5, -9);
scene.add(fill);

const camera = new PerspectiveCamera(50, 1, 0.01, 1000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

// The model group — everything exported lives here, in export coordinates.
const content = new Group();
scene.add(content);

// ---- built pieces (kept for export + disposal) ---------------------------
let cone: LightCone;
let coneMesh: ConeMesh;
let rim: EndTube;
let rod: Mesh;
let coneMidT = 0;

// The [min, max] coordinate-time span of the traced cone (valid samples only),
// so the rod can be centred on it and grow symmetrically.
function coneTimeSpan(c: LightCone): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < c.rayCount; i += 1) {
    for (let j = 0; j < c.rayLengths[i]!; j += 1) {
      const t = c.coord(i, j, 0);
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
  }
  return [Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 0];
}

function buildRod(): void {
  if (rod) {
    content.remove(rod);
    rod.geometry.dispose();
    (rod.material as { dispose(): void }).dispose();
  }
  const half = state.rodLength / 2;
  rod = worldtube(HOLE, {
    embedding: EMBEDDING,
    tMin: coneMidT - half,
    tMax: coneMidT + half,
    radius: HOLE.radius,
  });
  content.add(rod);
}

// Full rebuild: re-trace the cone and rebuild surface + rim, then the rod.
function rebuild(): void {
  if (coneMesh) { content.remove(coneMesh); coneMesh.dispose(); }
  if (rim) { content.remove(rim); rim.dispose(); }

  const quality = {
    ...COARSE_CONE,
    maxRays: Math.max(state.rayBudget, COARSE_CONE.maxRays),
    minAngle: ANGLE_FLOOR,
  };
  cone = buildCone(manifold, OBSERVER, quality, {
    lambdaMax: LAMBDA_MAX,
    terminate: absorbedWithin([{ ...HOLE, radius: ABSORB_RADIUS }]),
  }).cone;
  const [lo, hi] = coneTimeSpan(cone);
  coneMidT = (lo + hi) / 2;

  // The surface is trimmed at exactly the rod radius → a clean rod-shaped hole.
  coneMesh = new ConeMesh(cone, {
    embedding: EMBEDDING,
    colorMode: "solid",
    trim: { centers: [HOLE] },
    tear: false,
  });
  content.add(coneMesh);

  rim = new EndTube(coneMesh.geometry, {
    radius: RIM_RADIUS,
    cut: { centers: [HOLE] },
    darken: RIM_DARKEN,
  });
  rim.visible = state.showTube;
  content.add(rim);

  buildRod();
  frameCamera();
}

function frameCamera(): void {
  const box = new Box3().setFromObject(content);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.6 || 5;
  camera.position.set(center.x + radius * 1.6, center.y + radius * 0.5, center.z + radius * 2.2);
  controls.target.copy(center);
  controls.update();
}

// ---- OBJ export ----------------------------------------------------------
function exportModel(): void {
  const coneObjects = state.showTube ? [coneMesh, rim] : [coneMesh];
  const text = exportOBJ([
    { name: "cone", objects: coneObjects },
    { name: "rods", objects: [rod] },
  ]);
  downloadText("lightfall-single.obj", text);
}

// ---- controls ------------------------------------------------------------
const rodSlider = document.getElementById("rod") as HTMLInputElement;
const rodVal = document.getElementById("rodVal")!;
const detailSlider = document.getElementById("detail") as HTMLInputElement;
const detailVal = document.getElementById("detailVal")!;
const tubeBox = document.getElementById("tube") as HTMLInputElement;
const exportBtn = document.getElementById("export") as HTMLButtonElement;

rodSlider.value = String(state.rodLength);
rodVal.textContent = state.rodLength.toFixed(0);
detailSlider.value = String(state.rayBudget);
detailVal.textContent = String(state.rayBudget);
tubeBox.checked = state.showTube;

rodSlider.addEventListener("input", () => {
  state.rodLength = Number(rodSlider.value);
  rodVal.textContent = state.rodLength.toFixed(0);
  buildRod(); // cheap: only the rod changes
});

let detailRaf = 0;
detailSlider.addEventListener("input", () => {
  state.rayBudget = Number(detailSlider.value);
  detailVal.textContent = String(state.rayBudget);
  if (detailRaf) return;
  detailRaf = requestAnimationFrame(() => {
    detailRaf = 0;
    rebuild();
  });
});

tubeBox.addEventListener("change", () => {
  state.showTube = tubeBox.checked;
  rim.visible = state.showTube;
});

exportBtn.addEventListener("click", exportModel);

// ---- run loop ------------------------------------------------------------
function resize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}
function tick(): void {
  resize();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

rebuild();
tick();
