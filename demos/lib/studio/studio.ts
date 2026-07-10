import {
  ACESFilmicToneMapping,
  Box3,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { WebGLPathTracer } from "three-gpu-pathtracer";

import {
  createEnvironment,
  type EnvPresetName,
  type StudioEnvironment,
} from "./environment.ts";

export type StudioMode = "live" | "trace";

// What the path tracer needs re-synced before the next sample. Separating these
// keeps a cheap camera nudge from triggering a full BVH rebuild.
type Dirty = "scene" | "camera" | "materials" | "environment" | "lights";

// The movable key light, in spherical coordinates about the content centre.
export interface KeyLight {
  azimuth: number; // radians, around the vertical axis
  elevation: number; // radians, above the horizon
  distance: number; // multiple of the content radius
  intensity: number;
}

export interface StudioOptions {
  environment?: EnvPresetName;
  bounces?: number;
  cameraPosition?: [number, number, number];
  target?: [number, number, number];
}

// The rendering studio: one canvas and WebGLRenderer shared by a cheap raster
// preview ("live") and progressive path tracing ("trace"). The path tracer is
// built lazily on first trace; a dirty-flag set collected each frame decides
// whether to rebuild the BVH (scene changed) or just nudge the camera/materials/
// environment. No instancing anywhere in lightfall, so there is no baked-twin
// geometry to juggle — the same meshes feed both paths.
export class Studio {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls;
  readonly canvas: HTMLCanvasElement;

  // Fired after each accumulated path-traced sample.
  onSample: ((samples: number) => void) | null = null;

  // The movable key light, driven by sliders and restored from a saved view.
  readonly keyLight: KeyLight = { azimuth: 0.3, elevation: 0.95, distance: 2.9, intensity: 2.4 };

  // How far the right (side) wall sits behind the cone's end (fraction of radius).
  sideMargin = 0.35;

  private _mode: StudioMode = "live";
  private pathTracer: WebGLPathTracer | null = null;
  private env!: StudioEnvironment;
  private readonly dirty = new Set<Dirty>();
  private aspect: number | null = null;
  private outputSize: { w: number; h: number } | null = null;
  private readonly bounces: number;
  private disposed = false;

  constructor(options: StudioOptions = {}) {
    this.bounces = options.bounces ?? 24;

    this.canvas = document.createElement("canvas");
    this.canvas.id = "studio-canvas";
    document.body.appendChild(this.canvas);

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      preserveDrawingBuffer: true, // needed for PNG export
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.toneMapping = ACESFilmicToneMapping;

    this.camera = new PerspectiveCamera(50, 1, 0.01, 5000);
    this.camera.position.set(...(options.cameraPosition ?? [24, 16, 20]));

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    if (options.target) this.controls.target.set(...options.target);
    // Orbiting invalidates an accumulating trace: restart it.
    this.controls.addEventListener("change", () => this.markDirty("camera"));

    this.setEnvironment(options.environment ?? "light");

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.loop();
  }

  // --- mode -----------------------------------------------------------------

  get mode(): StudioMode {
    return this._mode;
  }

  set mode(m: StudioMode) {
    if (m === this._mode) return;
    this._mode = m;
    // Preview-only lights are dead weight in a physically-lit trace.
    for (const { light, intensity } of this.env.previewLights) {
      light.intensity = m === "trace" ? 0 : intensity;
    }
    if (m === "trace") {
      this.ensureTracer();
      this.markDirty("scene");
    }
  }

  get samples(): number {
    return this.pathTracer?.samples ?? 0;
  }

  // --- change signals -------------------------------------------------------

  // The scene graph's geometry changed (a rebuilt cone): the BVH must rebuild.
  contentChanged(): void {
    this.markDirty("scene");
  }

  // Only material properties changed (e.g. colour mode): no BVH rebuild needed.
  materialsChanged(): void {
    this.markDirty("materials");
  }

  private markDirty(kind: Dirty): void {
    this.dirty.add(kind);
  }

  private ensureTracer(): void {
    if (this.pathTracer) return;
    const pt = new WebGLPathTracer(this.renderer);
    pt.renderScale = Math.max(1 / window.devicePixelRatio, 0.5);
    pt.tiles.setScalar(3);
    pt.bounces = this.bounces;
    pt.filterGlossyFactor = 10;
    pt.renderDelay = 0;
    pt.minSamples = 0;
    pt.fadeDuration = 0;
    pt.dynamicLowRes = false;
    this.pathTracer = pt;
  }

  // Apply everything pending, cheapest sufficient update winning. A scene
  // rebuild subsumes the rest, so it short-circuits.
  private flush(): void {
    if (this.dirty.size === 0 || !this.pathTracer) return;
    if (this.dirty.has("scene")) {
      this.pathTracer.setScene(this.scene, this.camera);
      this.dirty.clear();
      return;
    }
    if (this.dirty.has("environment")) this.pathTracer.updateEnvironment();
    if (this.dirty.has("lights")) this.pathTracer.updateLights();
    if (this.dirty.has("materials")) this.pathTracer.updateMaterials();
    if (this.dirty.has("camera")) this.pathTracer.updateCamera();
    this.dirty.clear();
  }

  // --- environment ----------------------------------------------------------

  setEnvironment(name: EnvPresetName): void {
    if (this.env?.name === name) return;
    if (this.env) {
      for (const o of this.env.objects) this.scene.remove(o);
      this.env.dispose();
    }
    this.env = createEnvironment(name);
    for (const o of this.env.objects) this.scene.add(o);
    this.scene.environment = this.env.environment;
    this.scene.background = this.env.background;
    for (const { light, intensity } of this.env.previewLights) {
      light.intensity = this._mode === "trace" ? 0 : intensity;
    }
    this.keyLight.intensity = this.env.keyIntensity;
    this.frameStudio();
    // A fresh environment + new light objects: the tracer must re-scan the scene.
    this.markDirty("scene");
  }

  // Slide the cyclorama to hug the current content, then place the key light.
  frameStudio(): void {
    this.env.frame(this.contentBounds(), this.sideMargin);
    this.applyKeyLight();
    this.markDirty("scene");
  }

  // Move the key light (spherical about the content centre).
  setKeyLight(patch: Partial<KeyLight>): void {
    Object.assign(this.keyLight, patch);
    this.applyKeyLight();
  }

  private applyKeyLight(): void {
    const b = this.contentBounds();
    const c = b.getCenter(new Vector3());
    const size = b.getSize(new Vector3());
    const r = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    const { azimuth: az, elevation: el, distance, intensity } = this.keyLight;
    const d = distance * r;
    const spot = this.env.keyLight;
    spot.position.set(
      c.x + d * Math.cos(el) * Math.cos(az),
      c.y + d * Math.sin(el),
      c.z - d * Math.cos(el) * Math.sin(az),
    );
    spot.target.position.copy(c);
    spot.intensity = intensity;
    spot.radius = r * 0.06;
    spot.shadow.camera.near = 0.1;
    spot.shadow.camera.far = r * 12;
    this.markDirty("lights");
  }

  // Restore an exact camera pose (from a saved view).
  setCameraPose(position: [number, number, number], target: [number, number, number]): void {
    this.camera.position.set(...position);
    this.controls.target.set(...target);
    this.controls.update();
    this.markDirty("camera");
  }

  // Place the camera at a reference-style 3/4 low angle looking at the content.
  frameCamera(): void {
    const b = this.contentBounds();
    const c = b.getCenter(new Vector3());
    const dist = b.getSize(new Vector3()).length() * 1.1 || 12;
    // Between +X and −Z, low elevation — the charged-blackholes framing.
    const az = Math.PI / 4;
    const el = 0.14;
    const dir = new Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      -Math.cos(el) * Math.sin(az),
    );
    this.camera.position.copy(c).addScaledVector(dir, dist);
    this.controls.target.copy(c);
    this.controls.update();
    this.markDirty("camera");
  }

  private contentBounds(): Box3 {
    const box = new Box3();
    const envSet = new Set<object>(this.env.objects);
    this.scene.updateMatrixWorld(true);
    // Frame by the cone content only: skip the studio props and anything flagged
    // `noBound` (the horizon rods, which deliberately run off-frame).
    this.scene.traverse((o) => {
      if (envSet.has(o) || o.userData.noBound) return;
      const mesh = o as Mesh;
      if (mesh.isMesh && mesh.geometry) box.expandByObject(mesh);
    });
    return box.isEmpty() ? new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)) : box;
  }

  // --- sizing & loop --------------------------------------------------------

  // Constrain the live frame to a fixed aspect ratio (letterboxed), or null to
  // fill the window. Ignored while an exact output size is active.
  setAspect(aspect: number | null): void {
    this.aspect = aspect;
    if (!this.outputSize) this.resize();
  }

  // Render at an exact pixel size — the drawing buffer becomes width×height
  // (letterboxed to fit on screen), so a screenshot is exactly that size. Starts
  // path tracing so the frame accumulates; grab it any time with saveScreenshot,
  // before the sample count is anywhere near done.
  setOutputSize(width: number, height: number): void {
    this.outputSize = { w: Math.round(width), h: Math.round(height) };
    this.mode = "trace";
    this.ensureTracer();
    this.resize();
    this.markDirty("scene"); // re-init the tracer's render targets at the new size
  }

  // Back to filling the window.
  clearOutputSize(): void {
    this.outputSize = null;
    this.resize();
    this.markDirty("scene");
  }

  get outputActive(): boolean {
    return this.outputSize !== null;
  }

  // The current drawing-buffer size in pixels (what a screenshot will be).
  get pixelSize(): [number, number] {
    return [this.canvas.width, this.canvas.height];
  }

  // Download the current frame as a PNG (works mid-accumulation).
  saveScreenshot(filename: string): void {
    const link = document.createElement("a");
    link.href = this.canvas.toDataURL("image/png");
    link.download = filename;
    link.click();
  }

  private resize(): void {
    const availW = window.innerWidth;
    const availH = window.innerHeight;
    let bufW: number;
    let bufH: number;
    let pixelRatio: number;
    let cssW: number;
    let cssH: number;

    if (this.outputSize) {
      // Exact export buffer; scale it down with CSS to fit the screen.
      bufW = this.outputSize.w;
      bufH = this.outputSize.h;
      pixelRatio = 1;
      const fit = Math.min(availW / bufW, availH / bufH, 1);
      cssW = bufW * fit;
      cssH = bufH * fit;
    } else {
      let w = availW;
      let h = availH;
      if (this.aspect) {
        if (availW / availH > this.aspect) w = Math.round(availH * this.aspect);
        else h = Math.round(availW / this.aspect);
      }
      bufW = w;
      bufH = h;
      pixelRatio = window.devicePixelRatio;
      cssW = w;
      cssH = h;
    }

    this.canvas.style.position = "fixed";
    this.canvas.style.left = "50%";
    this.canvas.style.top = "50%";
    this.canvas.style.transform = "translate(-50%, -50%)";
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(bufW, bufH, false);
    this.camera.aspect = bufW / bufH;
    this.camera.updateProjectionMatrix();
    if (this.pathTracer) {
      // Full resolution for an exact export; half-ish for the live preview.
      this.pathTracer.renderScale = this.outputSize
        ? 1
        : Math.max(1 / window.devicePixelRatio, 0.5);
      // Keep each internal pass well under GPU limits; more tiles for big exports.
      const bw = bufW * pixelRatio;
      const bh = bufH * pixelRatio;
      this.pathTracer.tiles.set(
        this.outputSize ? Math.max(1, Math.ceil(bw / 1024)) : 3,
        this.outputSize ? Math.max(1, Math.ceil(bh / 1024)) : 3,
      );
    }
    this.markDirty("camera");
  }

  private loop = (): void => {
    if (this.disposed) return;
    requestAnimationFrame(this.loop);
    this.controls.update();
    if (this._mode === "trace" && this.pathTracer) {
      this.flush();
      this.pathTracer.renderSample();
      this.onSample?.(this.samples);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  };

  dispose(): void {
    this.disposed = true;
    this.controls.dispose();
    this.env.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
