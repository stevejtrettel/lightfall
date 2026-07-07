// The render layer: adapters that turn lightfall's computed geometry into
// pictures. This barrel is the dependency-free 2D SVG projection. The Three.js
// 3D view lives in `./three/` and is imported from there directly, so nothing
// that only wants SVG (tests, CLI) ever loads Three.js. Both consume the same
// LightCone grid.
export * from "./svg/index.ts";
