// The lightfall viewer. Owns the renderer, camera, controls, lights, and run
// loop; a scene populates the Three.js scene and returns a handle (label,
// camera hint, colour-mode toggle, quality rebuild).

import {
  AmbientLight,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { REFINE_CONE } from "../src/lightcone/index.ts";
import { runLightcone } from "./scenes/lightcone.ts";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new Scene();
scene.background = new Color(0x0a0a0f);

const camera = new PerspectiveCamera(50, 1, 0.01, 1000);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new AmbientLight(0xffffff, 0.5));
const key = new DirectionalLight(0xffffff, 1.0);
key.position.set(6, 12, 8);
scene.add(key);
const fill = new DirectionalLight(0x88aaff, 0.4);
fill.position.set(-8, 5, -9);
scene.add(fill);

const handle = runLightcone(scene);
document.getElementById("label")!.textContent = handle.label;
camera.position.set(...handle.camera.position);
controls.target.set(...handle.camera.target);
controls.update();

const redshiftBox = document.getElementById("redshift") as HTMLInputElement;
redshiftBox.addEventListener("change", () => {
  handle.setColorMode(redshiftBox.checked ? "redshift" : "solid");
});

const raysBox = document.getElementById("rays") as HTMLInputElement;
raysBox.addEventListener("change", () => {
  handle.setShowRays(raysBox.checked);
});

const refineBtn = document.getElementById("refine") as HTMLButtonElement;
const status = document.getElementById("status")!;

// Live scene sliders: geodesic length (affine extent) and observer distance.
// Initialise from the scene's own defaults so the labels never lie.
const lengthSlider = document.getElementById("length") as HTMLInputElement;
const lengthVal = document.getElementById("lengthVal")!;
const distanceSlider = document.getElementById("distance") as HTMLInputElement;
const distanceVal = document.getElementById("distanceVal")!;
lengthSlider.value = String(handle.params.lambdaMax);
lengthVal.textContent = lengthSlider.value;
distanceSlider.value = String(handle.params.observerDistance);
distanceVal.textContent = distanceSlider.value;

// Angular-detail slider = ray budget, 300 → 4000 on a log map so each step is a
// constant factor. Worst-first refinement spends the budget on the widest
// endpoint gaps first, so raising it fills the most stretched-thin regions.
const detailSlider = document.getElementById("detail") as HTMLInputElement;
const detailVal = document.getElementById("detailVal")!;
const detailToBudget = (d: number): number =>
  Math.round(600 * 10 ** ((d / 100) * Math.log10(6000 / 600)));

// Coalesce drags to one rebuild per frame so a fast drag can't queue a backlog
// of blocking rebuilds.
let rebuildQueued = false;
function queueParamRebuild(): void {
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => {
    rebuildQueued = false;
    const { rays, worstGap } = handle.setParams({
      lambdaMax: Number(lengthSlider.value),
      observerDistance: Number(distanceSlider.value),
      rayBudget: detailToBudget(Number(detailSlider.value)),
    });
    // The budget slider's readout is the resulting ray count; `status` shows the
    // worst remaining gap so you can tell when more budget stops helping (the
    // photon-sphere plateau). `status` proper is left for the refine button.
    detailVal.textContent = `${rays}`;
    status.textContent = `worst gap ${worstGap.toFixed(1)}`;
  });
}
lengthSlider.addEventListener("input", () => {
  lengthVal.textContent = lengthSlider.value;
  queueParamRebuild();
});
distanceSlider.addEventListener("input", () => {
  distanceVal.textContent = distanceSlider.value;
  queueParamRebuild();
});
detailSlider.addEventListener("input", queueParamRebuild);

refineBtn.addEventListener("click", () => {
  refineBtn.disabled = true;
  status.textContent = "computing refine…";
  // Two frames so the "computing" label paints before the blocking rebuild.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const { rays, worstGap } = handle.rebuild(REFINE_CONE);
      status.textContent = `refined — ${rays} rays, worst gap ${worstGap.toFixed(1)}`;
      refineBtn.disabled = false;
    }),
  );
});

function resize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

function frame(): void {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
