import { resolve } from "node:path";
import { defineConfig } from "vite";

// Dev (`npm run dev`): serve the browser demos from `demos/`.
//
// Three.js and everything that touches it live under `demos/` and
// `src/render/`; the `src/math` core never imports a renderer, so the
// library stays testable and portable without this config.
//
// One HTML entry per demo (a landing page plus one folder per lightcone
// scene). Vite serves them by path in dev; the build needs each listed.
const root = resolve(import.meta.dirname, "demos");
const page = (slug: string): string => resolve(root, slug, "index.html");

export default defineConfig({
  root: "demos",
  server: {
    port: 3000,
    open: true,
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(root, "index.html"),
        nearFlat: page("near-flat"),
        single: page("single"),
        binary: page("binary"),
        triple: page("triple"),
        quad: page("quad"),
        double: page("double"),
        print: page("print"),
      },
    },
  },
});
