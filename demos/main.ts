// The lightfall viewer. Owns the renderer, camera, controls, lights, and run
// loop; a scene populates the Three.js scene and returns a label, a camera
// hint, and the cone mesh (so the redshift toggle can reach it).

import {
  AmbientLight,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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

const result = runLightcone(scene);
document.getElementById("label")!.textContent = result.label;
camera.position.set(...result.camera.position);
controls.target.set(...result.camera.target);
controls.update();

const redshiftBox = document.getElementById("redshift") as HTMLInputElement;
redshiftBox.addEventListener("change", () => {
  result.cone.setColorMode(redshiftBox.checked ? "redshift" : "solid");
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
