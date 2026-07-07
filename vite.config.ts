import { defineConfig } from "vite";

// Dev (`npm run dev`): serve the browser demos from `demos/`.
//
// Three.js and everything that touches it live under `demos/` and
// `src/render/`; the `src/math` core never imports a renderer, so the
// library stays testable and portable without this config.
export default defineConfig({
  root: "demos",
  server: {
    port: 3000,
    open: true,
  },
});
