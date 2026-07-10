import {
  AmbientLight,
  Box3,
  BoxGeometry,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  Vector3,
  type Texture,
} from "three";
import { GradientEquirectTexture, PhysicalSpotLight } from "three-gpu-pathtracer";

// A studio environment: the image-based lighting gradient (used as both the
// scene environment and background), the analytic lights, and the studio props
// (a corner cyclorama — floor + back wall + side wall — like the charged-
// blackholes reference). `frame(bounds)` positions the props and light around
// the current content. The path tracer reads scene.environment/background for
// IBL and honours the PhysicalSpotLight as a soft area light; the AmbientLight
// only lifts the raster preview.

export type EnvPresetName = "light" | "dark";

export const ENV_PRESETS: EnvPresetName[] = ["light", "dark"];

export interface StudioEnvironment {
  readonly name: EnvPresetName;
  readonly background: Texture;
  readonly environment: Texture;
  readonly objects: Object3D[];
  readonly previewLights: { light: AmbientLight; intensity: number }[];
  // The movable key light (the studio positions it; sliders drive it).
  readonly keyLight: PhysicalSpotLight;
  // Preset default intensity for the key light.
  readonly keyIntensity: number;
  // Position floor / walls around the content bounds. `sideMargin` is how far
  // the right (side) wall sits behind the cone's end, as a fraction of radius.
  frame(bounds: Box3, sideMargin?: number): void;
  dispose(): void;
}

function gradient(top: number, bottom: number): GradientEquirectTexture {
  const tex = new GradientEquirectTexture();
  tex.topColor.set(top);
  tex.bottomColor.set(bottom);
  tex.update();
  return tex;
}

export function createEnvironment(name: EnvPresetName): StudioEnvironment {
  return name === "dark" ? darkStudio() : lightStudio();
}

// Bright product-render studio: grey→white cyclorama corner (floor, back wall,
// side wall), one soft key spotlight, white clearcoat props.
function lightStudio(): StudioEnvironment {
  const tex = gradient(0x666666, 0xffffff);
  const mat = new MeshPhysicalMaterial({
    color: 0xffffff,
    clearcoat: 1,
    roughness: 0.5,
    metalness: 0,
  });

  // Big planes; frame() slides them to hug the content. Thin boxes read as
  // seamless walls in the path tracer.
  const floor = new Mesh(new BoxGeometry(400, 0.2, 400), mat);
  const backWall = new Mesh(new BoxGeometry(400, 400, 0.2), mat);
  const sideWall = new Mesh(new BoxGeometry(0.2, 400, 400), mat);
  floor.receiveShadow = true;
  backWall.receiveShadow = true;
  sideWall.receiveShadow = true;

  const spot = new PhysicalSpotLight(0xffffff);
  spot.angle = Math.PI / 2.2;
  spot.decay = 0;
  spot.penumbra = 1;
  spot.distance = 0;
  spot.intensity = 2.4;
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);

  const ambient = new AmbientLight(0xffffff, 0.5);

  return {
    name: "light",
    background: tex,
    environment: tex,
    objects: [floor, backWall, sideWall, spot, spot.target, ambient],
    previewLights: [{ light: ambient, intensity: 0.5 }],
    keyLight: spot,
    keyIntensity: 2.4,
    frame(bounds, sideMargin) {
      frameCyclorama(bounds, floor, backWall, sideWall, sideMargin);
    },
    dispose() {
      tex.dispose();
      mat.dispose();
      floor.geometry.dispose();
      backWall.geometry.dispose();
      sideWall.geometry.dispose();
    },
  };
}

// Dark gallery studio: near-black cyclorama with a cool rim light and a dark
// reflective floor so the geometry floats.
function darkStudio(): StudioEnvironment {
  const tex = gradient(0x05060a, 0x141824);
  const mat = new MeshPhysicalMaterial({
    color: 0x0a0b12,
    roughness: 0.35,
    metalness: 0.2,
    clearcoat: 0.6,
    clearcoatRoughness: 0.4,
  });

  const floor = new Mesh(new BoxGeometry(400, 0.2, 400), mat);
  const backWall = new Mesh(new BoxGeometry(400, 400, 0.2), mat);
  const sideWall = new Mesh(new BoxGeometry(0.2, 400, 400), mat);
  floor.receiveShadow = true;

  const spot = new PhysicalSpotLight(0xdfe8ff);
  spot.angle = Math.PI / 2.4;
  spot.decay = 0;
  spot.penumbra = 1;
  spot.distance = 0;
  spot.intensity = 3.0;
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);

  const ambient = new AmbientLight(0x223044, 0.4);

  return {
    name: "dark",
    background: tex,
    environment: tex,
    objects: [floor, backWall, sideWall, spot, spot.target, ambient],
    previewLights: [{ light: ambient, intensity: 0.4 }],
    keyLight: spot,
    keyIntensity: 3.0,
    frame(bounds, sideMargin) {
      frameCyclorama(bounds, floor, backWall, sideWall, sideMargin);
    },
    dispose() {
      tex.dispose();
      mat.dispose();
      floor.geometry.dispose();
      backWall.geometry.dispose();
      sideWall.geometry.dispose();
    },
  };
}

// Slide the corner cyclorama to hug the content. Back wall at +Z, side wall at
// −X, floor below — the corner sits opposite the camera (which frames from
// +X / −Z), as in the reference. The key light is positioned by the studio.
function frameCyclorama(
  bounds: Box3,
  floor: Mesh,
  backWall: Mesh,
  sideWall: Mesh,
  sideMarginFactor = 0.35,
): void {
  const c = bounds.getCenter(new Vector3());
  const s = bounds.getSize(new Vector3());
  const r = Math.max(s.x, s.y, s.z) * 0.5 || 1;
  const backMargin = r * 0.6;
  // The right (side) wall sits just behind the end of the light cone.
  const sideMargin = r * sideMarginFactor;

  floor.position.set(c.x, bounds.min.y - 0.1, c.z);
  backWall.position.set(c.x, c.y, bounds.max.z + backMargin);
  sideWall.position.set(bounds.min.x - sideMargin, c.y, c.z);
}
