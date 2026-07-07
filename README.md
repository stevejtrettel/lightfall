# Lightfall

Interactive visualization of the **light cones of black-hole spacetimes** —
the causal structure of an event: the null geodesics that rule its light
cone, the lensed wavefronts that are its time-slices, and the caustics where
those wavefronts fold.

The first concrete target is the **Majumdar–Papapetrou** family of extremal
charged black holes (multiple charge = mass holes in static equilibrium),
drawn in an exact 2+1 slice. But the engine underneath is general: a
spacetime is nothing but a metric in a coordinate chart, and light cones are
traced by the Hamiltonian geodesic flow of that metric.

## Design

The full design record and the phased build plan live in
[`docs/plans/implementation-plan.md`](docs/plans/implementation-plan.md);
binding decisions are in [`docs/decisions/`](docs/decisions/). In short:

- **The math is independent of rendering.** Spacetimes, geodesic flow, and
  light cones compute and test with no Three.js and no DOM. Rendering is a
  downstream adapter.
- **A spacetime is a metric in a chart.** Geodesics are the Hamiltonian flow
  of `H = ½ gᵘᵛ pᵤ pᵥ` on `T*M`; null geodesics are the level set `{H = 0}`.
- **Compute once, render many.** A light cone is one computed object — a
  congruence of null geodesics. Its surface, rays, wavefronts, and spatial
  shadow are all *views* of that one object.

## Layout

```text
src/
  math/         general, reusable mathematics — no physics, no Three.js
    spaces/ domains/ linalg/ maps/ numerics/ lorentzian/
  spacetime/    concrete spacetimes as metric instances (Majumdar–Papapetrou, Minkowski, …)
  lightcone/    the null-geodesic congruence and its views
  render/three/ Three.js adapters + the spacetime → world embedding
demos/          Vite-served browser scenes
examples/       CLI numerical validations (drift tables, integrator comparison)
test/           one *.test.ts per module
docs/           plans (exploratory) and decisions (binding)
```

## Running

```bash
npm install
npm run typecheck    # strict TS, no emit
npm test             # node --test on test/*.test.ts
npm run dev          # Vite + Three.js demos in the browser
node examples/<file>.ts   # any CLI example
```

Node runs the `.ts` sources directly (type-stripping; requires Node ≥ 22.18)
— no build step for the math, tests, or CLI examples. The source stays inside
the erasable-syntax subset (no enums, namespaces, or parameter properties).
Vite handles the browser side. Runtime dependencies are zero in the `math/`
core; Three.js is confined to `src/render/` and `demos/`.

## Status

Pre-1.0, built in phases. Break things freely when the change is right.
