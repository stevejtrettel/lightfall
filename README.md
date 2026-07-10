# Lightfall

Interactive visualization of the **light cones of black-hole spacetimes** — the
causal structure of an event: the null geodesics that rule its light cone, the
lensed wavefronts that are its time-slices, and the caustics where those
wavefronts fold.

The first concrete target is the **Majumdar–Papapetrou (MP)** family of extremal
charged black holes — several charge = mass holes sitting in static equilibrium —
drawn in an exact 2+1 slice. But the engine underneath is general: a spacetime is
nothing but a metric in a coordinate chart, and light cones are traced by the
Hamiltonian geodesic flow of that metric. Minkowski and MP are just two metric
instances plugged into the same machinery.

---

## Contents

- [What you're looking at](#what-youre-looking-at)
- [The math](#the-math)
  - [A spacetime is a metric in a chart](#a-spacetime-is-a-metric-in-a-chart)
  - [Geodesics as Hamiltonian flow](#geodesics-as-hamiltonian-flow)
  - [The infinitesimal null cone](#the-infinitesimal-null-cone)
  - [The Majumdar–Papapetrou family](#the-majumdarpapapetrou-family)
  - [Gravitational redshift and the surface colouring](#gravitational-redshift-and-the-surface-colouring)
  - [Adaptive angular sampling](#adaptive-angular-sampling)
  - [Integrators and validation](#integrators-and-validation)
- [Architecture](#architecture)
- [Using the app](#using-the-app)
  - [Install and run](#install-and-run)
  - [The studio demos](#the-studio-demos)
  - [3D-print / OBJ export](#3d-print--obj-export)
  - [Serving to another machine](#serving-to-another-machine)
- [Using the library](#using-the-library)
  - [Build a light cone](#build-a-light-cone)
  - [Render it](#render-it)
  - [Add your own spacetime](#add-your-own-spacetime)
- [Repo layout](#repo-layout)
- [Design docs](#design-docs)
- [Status](#status)

---

## What you're looking at

Pick an event — an observer, here-and-now. Its **future light cone** is the set of
everything the flash from that event can ever reach: the history of an expanding
sphere of light, swept out in spacetime. In flat space that history is a plain
cone. Near mass it is not: gravity bends the null geodesics, so the cone lenses,
pinches, and folds.

Lightfall computes that cone once and shows it several ways:

- **The surface** — the cone as a solid 3D sheet in an `(x, y, t)` block, time
  drawn along one axis. Where light skims a black hole the sheet wraps around the
  hole's vertical **worldtube** (its horizon, fixed in space for all time), and
  gets absorbed into it — carving the **shadow**.
- **The wavefront** — a constant-time slice of the cone: the lensed sphere of
  light at one instant.
- **Caustics** — the curves where neighbouring rays cross and the wavefront folds
  back on itself. These are conjugate points of the geodesic congruence; they are
  where an observer sees multiple, magnified images.
- **Redshift** — the surface can be coloured by gravitational frequency shift:
  light climbing out of a well reddens, light falling in blueshifts.

Everything below is in service of computing that one congruence of null geodesics
correctly, and then reading many pictures off it.

---

## The math

### A spacetime is a metric in a chart

A spacetime is a coordinate chart $x^\mu$ plus a Lorentzian metric $g_{\mu\nu}(x)$
of signature $(-,+,+,\dots)$, with the time slot recorded. Lightfall's charts are
**2+1** — one time coordinate $t$ and two spatial coordinates $(x, y)$ — packed as
an `Event` with named components (`src/spacetime/chart.ts`), so `pos.t` is time
and `mom.x` is $p_x$, never confused.

The engine assumes nothing beyond that. Concretely, a spacetime must supply the
**inverse** metric and its coordinate derivatives (`src/math/lorentzian/metric.ts`):

$$g^{\mu\nu}(x), \qquad \partial_\lambda g^{\mu\nu}(x).$$

Why the inverse metric? Because the geodesic Hamiltonian and the null condition
are written with upper-index $g^{\mu\nu}$ acting on momenta $p_\mu$, so this is the
form the hot loop actually needs — no matrix inversion per step. Analytic
derivatives are used where available (MP has them in closed form); a
central-finite-difference fallback covers metrics that don't.

### Geodesics as Hamiltonian flow

A photon's worldline is a **null geodesic**. Rather than integrate the second-order
geodesic equation with Christoffel symbols, lightfall evolves the first-order
**Hamiltonian** flow of the canonical state $(x^\mu, p_\mu)$ on the cotangent
bundle $T^\*M$ (`src/math/lorentzian/geodesic-hamiltonian.ts`), with

$$H(x, p) = \tfrac12\, g^{\mu\nu}(x)\, p_\mu p_\nu.$$

Hamilton's equations give the flow:

$$\dot x^\mu = g^{\mu\nu}(x)\, p_\nu, \qquad \dot p_\lambda = -\tfrac12\, \big(\partial_\lambda g^{\mu\nu}(x)\big)\, p_\mu p_\nu.$$

Two facts make this the right choice:

- **Null geodesics are the level set $\{H = 0\}$.** The flow itself is agnostic to
  the value of $H$; the null condition is imposed once, in the initial momentum
  (see the next section). Along an exact trajectory $H$ is conserved, so its
  **drift is a coordinate-invariant error meter** — the honest way to check a trace
  (`hamiltonian(M)` computes it).
- **Symmetries become conserved momenta, for free.** If the metric doesn't depend
  on a coordinate $x^\lambda$ (a Killing direction), then $\dot p_\lambda = 0$ and
  $p_\lambda$ is conserved. For a **static** spacetime $\partial_t g^{\mu\nu} = 0$,
  so the photon energy $E \equiv -p_t$ is constant along every ray. This single
  fact drives the redshift colouring below.

The `VectorField` / integrator abstractions don't assume canonical coordinates, so
the equivalent Lagrangian form on $TM$ is not foreclosed — it was simply passed
over for RHS ergonomics, manifest conserved momenta, and the option of symplectic
integration. (See `docs/plans/implementation-plan.md` §3.3 for the full argument.)

### The infinitesimal null cone

To emit a ray we need a future-directed null covector $p_\mu$ for each spatial
emission angle $\theta$ (`src/math/lorentzian/null-cone.ts`). We fix the time
component to set the energy, $p_t = -E$, and let the spatial part be
$\rho\,(\cos\theta, \sin\theta)$ on the two spatial axes. Writing $p = f + \rho w$
with $f$ the fixed time part and $w$ the unit spatial direction, the null condition
$g^{\mu\nu} p_\mu p_\nu = 0$ becomes a plain quadratic in $\rho$:

$$G(w,w)\,\rho^2 + 2\,G(f,w)\,\rho + G(f,f) = 0, \qquad G \equiv g^{\mu\nu}(\text{apex}).$$

We take the outgoing root $\rho > 0$. This is exact for a **general** metric,
including off-diagonal ones — not just the diagonal isotropic case — and the
energy $E$ fixes the scale of the affine parameter. (2+1 for now: exactly two
spatial axes make $\theta$ a full parameterization of directions.)

### The Majumdar–Papapetrou family

The whole MP physics is downstream of one harmonic function, the **potential**
(`src/spacetime/majumdar-papapetrou.ts`):

$$U(x, y) = 1 + \sum_i \frac{m_i}{\lvert \mathbf{r} - \mathbf{r}_i \rvert}.$$

The 2+1 metric is, in inverse form,

$$g^{\mu\nu} = \operatorname{diag}\!\big(-U^2,\; U^{-2},\; U^{-2}\big) \quad\Longleftrightarrow\quad \mathrm{d}s^2 = -\,U^{-2}\,\mathrm{d}t^2 + U^2\,(\mathrm{d}x^2 + \mathrm{d}y^2).$$

- **Horizons** are the throats $r \to r_i$ where $U \to \infty$: a photon needs
  infinite coordinate time to reach one, and clocks there run infinitely slow
  relative to infinity.
- **Static equilibrium is automatic.** Each hole is *extremal* (charge = mass), so
  its electric repulsion exactly cancels its gravitational attraction — that is why
  a multi-hole static solution exists at all. You can place several holes anywhere
  and the metric is still an exact solution, frozen in time.
- **The 2+1 slice is honest.** It is an exact totally-geodesic slice of the full
  3+1 solution, not a dimensional cartoon.

Minkowski (`src/spacetime/minkowski.ts`), $g^{\mu\nu} = \operatorname{diag}(-1,1,1)$,
is the same interface with a constant metric — null geodesics are straight lines at
unit coordinate speed, and it is the validation baseline for the entire engine.

### Gravitational redshift and the surface colouring

A **static observer** has 4-velocity $u^\mu = (1/\sqrt{-g_{tt}},\,0,\,0)$. The
frequency it measures for a passing photon is $\omega = -p_\mu u^\mu$. In MP,
$\sqrt{-g_{tt}} = 1/U$, so

$$\omega(x) = \frac{-p_t}{\sqrt{-g_{tt}}} = E\,U(x).$$

Because the spacetime is static, $E$ is conserved, so **the locally measured
frequency is proportional to the potential**, $\omega \propto U(x)$. A remarkable
consequence: the accumulated frequency shift between any two points on a ray is
**path-independent** — it equals the ratio of the endpoint potentials,
$\omega(x)/\omega(x_0) = U(x)/U(x_0)$. A photon that dives toward a hole and climbs
back out returns to exactly its original colour.

The Three.js surface (`src/render/three/redshift.ts`) exposes three colouring
**anchors**, all reading a diverging warm/cool ramp centred on yellow:

- **`edge`** — each ray's own far endpoint is yellow; the colour accumulates toward
  the apex. History-dependent, with a real seam at the shadow edge (light skimming
  the horizon originates deep in the well and reads deep red).
- **`depth`** — shift by depth relative to the *observer's* potential. Continuous:
  deep → red, observer depth → yellow, far → blue. No history, no seam.
- **`infinity`** — as if every ray fell in from spatial infinity ($U \to 1$), so
  $\text{ratio} = U(x)$: a pure depth-blueshift map, yellow at infinity deepening to
  blue toward each well. Since $U \ge 1$ everywhere it never reddens — except rays
  that are actually *captured* keep their true near-throat origin and render the
  shadow in deep red.

### Adaptive angular sampling

The cone is coarse exactly where it matters (near holes, at the shadow edge, in the
strongly-lensed fans) and over-sampled where it doesn't (the smooth far field). So
emission angles are chosen **adaptively** (`src/lightcone/adaptive.ts`): seed a
coarse ring, then repeatedly trace the midpoint of the **worst** angular gap and
keep it, until a ray budget runs out. A gap's badness is the largest of three
worst-first criteria:

1. **Curvature** — the midpoint's sag versus the chord of its neighbours, against an
   *absolute* world-unit tolerance (so sharpening the lens does not flood the calm
   sky).
2. **Fate mismatch** (priority $\infty$) — one neighbour escapes, the other is
   captured: the shadow boundary, always split first.
3. **Element size** — neighbour separation against an absolute cap: the
   even-sampling knob that fills the stretched-thin lensed fans a flat sag would
   miss.

Crucially this only changes ray *generation*: the sampler returns the same
`LightCone` grid (with non-uniform `directions`), and every downstream view is
untouched. The full derivation, the two regimes (converging vs. pure budget-driven
fill), and the subtleties (the photon-sphere log singularity, padded strand tails,
the $\theta$-circle wrap) are in
[`docs/plans/adaptive-angular-sampling.md`](docs/plans/adaptive-angular-sampling.md).

### Integrators and validation

The flow is integrated behind one `Method` interface (`src/math/numerics/`), with
two implementations kept honest against each other:

- **Dormand–Prince (DOPRI5)** — adaptive-step explicit RK, the default. A tiny
  `minStep` lets it crawl deep into a throat where $U^2$ blows up.
- **Implicit midpoint** — a symplectic integrator, so the quadratic invariant and
  the $H = 0$ constraint are respected over long traces rather than drifting.

Validation leans on the invariants the Hamiltonian form hands us: $H$ should stay
$0$ and $E = -p_t$ should stay constant; their drift is the coordinate-invariant
error meter. Minkowski is the ground truth — if anything downstream bends a
Minkowski photon, the bug is ours, not the physics. The CLI in `examples/` renders
drift tables and integrator comparisons; `test/` has one `*.test.ts` per module.

---

## Architecture

Two commitments shape the whole codebase (full record in
[`docs/decisions/`](docs/decisions/)):

**The math is independent of rendering.** Spacetimes, geodesic flow, and light
cones compute and test with **zero runtime dependencies** and no DOM. Three.js is
confined to `src/render/three/` and `demos/`; the SVG adapter
(`src/render/svg/`) is dependency-free, so tests and CLI never load a renderer.

**Compute once, render many.** A light cone is a single computed object — a
congruence of null geodesics stored as a `positions[ray][sample]` grid of `(t,x,y)`
points. Its surface, rays, `wavefront(t)`, and shadow are all *views* of that one
grid. The emission-direction sampler (uniform or adaptive) is an injected
parameter, not a forked file.

```text
chart (Event)  →  metric g^{μν}, ∂g^{μν}  →  LorentzianManifold
      →  geodesicHamiltonian (H = ½ gᵘᵛ pᵤ pᵥ)  →  RayTracer (integrate one θ)
      →  adaptiveLightCone / lightCone (sample θ, assemble grid)  →  LightCone
      →  views:  ConeMesh · EndTube · worldtube · ConeRays · SVG · OBJ export
```

---

## Using the app

### Install and run

```bash
npm install
npm run typecheck    # strict TS, no emit
npm test             # node --test on test/*.test.ts
npm run dev          # Vite + Three.js demos in the browser
npm run build        # static production bundle (demos/dist)
node examples/<file>.ts   # any CLI example
```

Node runs the `.ts` sources directly (type-stripping; requires **Node ≥ 22.18**) —
no build step for the math, tests, or CLI examples. The source stays in the
erasable-syntax subset (no enums, namespaces, or parameter properties). Vite handles
the browser side.

### The studio demos

`npm run dev`, then open one scene. Each is the same engine over a different hole
configuration:

| Path | Scene |
|------|-------|
| `/near-flat/` | near-massless control — an almost-perfect straight cone |
| `/single/` | one `m = 1` hole — the classic lensed cone |
| `/binary/` `/triple/` `/quad/` | multi-hole systems, shadows merging |
| `/double/` | the full future **and** past cone of an event |
| `/print/` | the stripped-down 3D-print / OBJ exporter (below) |

The studio panel drives one live model — every edit recomputes at the cheapest
sufficient level (a colour tweak never re-traces; a vertical stretch never rebuilds
geometry):

- **render** — `path trace` toggles the progressive GPU path tracer; `redshift`
  switches the surface to the frequency-shift colouring, with `scale`,
  `exaggeration`, and the `anchor` dropdown (per-ray / by depth / from infinity);
  `boundary tube` and `traced rays` overlays; `ray budget` sets the adaptive
  sampler's ray count.
- **geometry** — `time stretch` (vertical scale of the block), observer position,
  per-hole `mass`/`x`/`y`, and `geodesic len` (how far along the rays to trace).
- **studio** — environment, key light, and **save view** (persists the whole
  composition to `localStorage` as that page's reload default).
- **export** — aspect / size / **save PNG** of the path-traced render.

### 3D-print / OBJ export

`/print/` is a lean standalone viewer (no path tracer) built to export a printable
model of the single-black-hole cone. Controls: **rod length** (resizes the horizon
pillar, centred on the cone), **detail** (adaptive ray budget), a **rim tube**
checkbox, and **export OBJ**.

The download is one `.obj` with **two separate objects**:

- `o cone` — the lightcone surface (plus the rim tube, if enabled). The surface is
  trimmed **exactly at the rod radius** — the clip solves the circle crossing in
  closed form — so it has a clean rod-shaped hole that overlaps the rod by a hair
  for a gap-free union.
- `o rods` — the horizon pillar: an already-capped, watertight cylinder.

Blender → STL (the surface is a zero-thickness sheet; the rod is already solid):

1. **File → Import → Wavefront (.obj)** with **Split by Object** on → you get
   `cone` and `rods` as two meshes.
2. Select **`cone`** → Edit Mode → **Merge by Distance** (welds the trim-seam
   vertices) → add a **Solidify** modifier for thickness.
3. If a caustic cusp self-intersects after Solidify, add a **Voxel Remesh** to
   rebuild a clean manifold.
4. `rods` needs nothing. Export STL.

### Serving to another machine

The dev server hot-reloads, which restarts the path tracer's sample accumulation on
every edit. For a **stable** view on a second computer (uninterrupted accumulation),
serve a build instead — it's a frozen snapshot that runs entirely client-side after
load:

```bash
npm run build
npx vite preview --host        # prints a http://<lan-ip>:4173/ URL
```

Add `--host` to `npm run dev` too if you just want live reload over the LAN. Both
require the two machines to be on the same network (a private address, not the
public internet); allow `node` through the firewall if the first load stalls.

---

## Using the library

The `math/` and `lightcone/` layers are plain TypeScript with no DOM and no
renderer, so you can compute cones in Node.

### Build a light cone

```ts
import { majumdarPapapetrou, Event } from "./src/spacetime/index.ts";
import { buildCone, COARSE_CONE, REFINE_CONE, absorbedWithin } from "./src/lightcone/index.ts";

// Two equal holes; observer sitting below them, apex at t = 0.
const manifold = majumdarPapapetrou([
  { mass: 1, x: -1.3, y: 0 },
  { mass: 1, x:  1.3, y: 0 },
]);
const apex = Event.of(0, 0, -5);

const { cone, report } = buildCone(manifold, apex, REFINE_CONE, {
  lambdaMax: 14,                                  // how far to trace each ray
  terminate: absorbedWithin([                     // rays swallowed near a throat
    { x: -1.3, y: 0, radius: 0.15 },
    { x:  1.3, y: 0, radius: 0.15 },
  ]),
});

console.log(cone.rayCount, "rays,", cone.sampleCount, "samples/ray");
console.log("converged:", report.converged, "— worst gap:", report.worstGap);

// A view: the lensed wavefront at t = 6, one point per ray that has reached it.
const front = cone.wavefront(6);
```

`COARSE_CONE` / `REFINE_CONE` are quality presets (`src/lightcone/quality.ts`); for
a fixed uniform sampling use `lightCone(manifold, apex, { directions, samples, step })`
with `uniformDirections(n)` from `src/lightcone/samplers.ts`.

### Render it

In the browser (Three.js), the same `cone` drives every view:

```ts
import { ConeMesh, EndTube, worldtube, timeUp, exportOBJ, downloadText } from "./src/render/three/index.ts";

const embedding = timeUp(1);                      // world (x, y, z) = (x, t·scale, y)
const holes = [{ x: -1.3, y: 0, radius: 0.3 }, { x: 1.3, y: 0, radius: 0.3 }];

const mesh = new ConeMesh(cone, {
  embedding,
  colorMode: "redshift",
  redshift: { scale: 1.5, exaggeration: 1, anchor: "infinity" },
  trim: { centers: holes },                       // cut cleanly at the throats
});
const rim = new EndTube(mesh.geometry, { cut: { centers: holes }, darken: 0.82 });
const rod = worldtube(holes[0], { embedding, tMin: -8, tMax: 8, radius: 0.3 });

// scene.add(mesh, rim, rod)  — and to export a printable OBJ:
downloadText("cone.obj", exportOBJ([
  { name: "cone", objects: [mesh, rim] },
  { name: "rods", objects: [rod] },
]));
```

### Add your own spacetime

A spacetime is a `LorentzianManifold`: a chart plus a `metric` that writes the
inverse metric and its derivatives into preallocated matrices. Copy Minkowski as
the template:

```ts
import { LorentzianManifold, metric } from "./src/math/lorentzian/index.ts";
import { spacetimeChart, TIME_INDEX, type Event } from "./src/spacetime/chart.ts";

export function mySpacetime(): LorentzianManifold<Event> {
  const g = metric({
    dimension: 3,
    timeIndex: TIME_INDEX,
    // g^{μν}(x) at the chart point `pt`.
    gInverseInto: (out, pt) => {
      const x = pt.buffer[pt.offset + 1]!;
      const y = pt.buffer[pt.offset + 2]!;
      out.zero();
      out.set(0, 0, /* g^{tt} */ -1);
      out.set(1, 1, /* g^{xx} */  1);
      out.set(2, 2, /* g^{yy} */  1);
    },
    // ∂_k g^{μν}(x). Return early for the time index if the metric is static.
    gInverseDerivativeInto: (out, pt, k) => {
      out.zero();
      // ...fill ∂_k of each component; omit for a flat/constant metric.
    },
  });
  return new LorentzianManifold(spacetimeChart("MySpacetime"), g);
}
```

Everything downstream — geodesic flow, the null cone, adaptive sampling, all the
views — works unchanged. Analytic derivatives are preferred (as in MP); if you
leave them out, wire in the finite-difference fallback.

---

## Repo layout

```text
src/
  math/                 general, reusable mathematics — no physics, no Three.js
    spaces/             typed buffer-backed points, products, bundles (T*M)
    linalg/             small dense matrices and vector spaces
    maps/               scalar & vector fields (in-place RHS for integrators)
    numerics/           integrators behind one Method interface (DOPRI5, symplectic)
    lorentzian/         metric, manifold, geodesic Hamiltonian, null cone
  spacetime/            concrete metrics: Majumdar–Papapetrou, Minkowski, the chart
  lightcone/            the null-geodesic congruence and its views + samplers
    trace · light-cone · samplers · adaptive · quality · caustics
  render/
    svg/                dependency-free 2D projection
    three/             Three.js adapters + the spacetime → world embedding
                        (cone-mesh, end-tube, worldtube, cone-rays, redshift, obj-export)
demos/                  Vite-served browser scenes (studio + print) and the studio viewer
examples/               CLI numerical validations / SVG renders
test/                   one *.test.ts per module
docs/                   plans (exploratory) and decisions (binding)
```

## Design docs

- [`docs/plans/implementation-plan.md`](docs/plans/implementation-plan.md) — the full
  design record and phased build plan (the `§` references above point here).
- [`docs/plans/adaptive-angular-sampling.md`](docs/plans/adaptive-angular-sampling.md) —
  the adaptive sampler in depth.
- [`docs/decisions/`](docs/decisions/) — binding architectural commitments.

## Status

Pre-1.0, built in phases. Break things freely when the change is right. The `math/`
core stays dependency-free; Three.js stays confined to `src/render/three/` and
`demos/`.
