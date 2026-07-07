# Lightfall — Implementation Plan

Interactive visualization of the **light cones of black-hole spacetimes**.
This document is the design record and the phased build plan. It is a
plan, not a contract: revise it freely as we learn, but keep it honest —
when a decision changes, change it here.

---

## 1. Purpose and scope

Lightfall draws the causal structure of black-hole spacetimes: the light
cone of an event, the null geodesics that rule it, the lensed wavefronts
that are its time-slices, and the caustics where those wavefronts fold.

**Ownership.** Lightfall is a single, self-contained repository that owns
100% of its code. The sibling projects `math-lab` and `charged-blackholes`
are *inspiration only* — we lift ideas and paste snippets freely, then
rewrite them as first-class lightfall code in one coherent voice. A reader
of lightfall never learns it borrowed anything. There is no "vendored"
layer and no provenance boundary.

**First concrete target.** Majumdar–Papapetrou (MP) extremal charged black
holes — multiple charge=mass holes in static equilibrium — in a 2+1
dimensional slice (one time, two space). This is rich, beautiful, and
self-contained, and it exercises the whole pipeline.

The slice is exact, not a cartoon: with every hole in the $z=0$ plane,
$z \mapsto -z$ is an isometry of the 3+1 MP solution, so the plane is
totally geodesic — null geodesics of the induced 2+1 metric *are* null
geodesics of the full spacetime that start (and therefore stay) in the
plane. What we draw is a true slice of the real thing.

**Ambition beyond the first target.** The engine is *general*: a spacetime
is nothing but a metric in a coordinate chart. MP is one metric plugged
into that engine. Other spacetimes (Minkowski, Schwarzschild, and later
genuinely non-conformally-flat metrics) slot in the same way.

**Dimensional target.** 2+1 is the primary visualization target because the
light cone is then a genuine *drawable surface*: one emission angle
parameterizes the rulings. In 3+1 the cone is a two-angle family and no
longer a single surface. The mathematical core is written so that
dimension is not hardcoded, but the surface/rendering layer targets 2+1.

---

## 2. Guiding principles

Restated as ours, in the spirit of the reference libraries:

1. **The math is independent of rendering.** The spacetime, the geodesic
   flow, the light cone — all computable and testable with no Three.js, no
   DOM, no canvas. Rendering is a downstream adapter.
2. **Math-shaped authoring, data-oriented execution.** Code reads like the
   mathematics (`majumdarPapapetrou(holes)`, `geodesicHamiltonian(M)`,
   `lightCone(event, directions)`); underneath, state is packed into typed
   arrays and hot loops are allocation-free.
3. **Structure is a tool, not a property of layout.** A `Space` is a
   layout; a Lorentzian metric is a structure laid on top. Operations that
   need the metric take the richer type.
4. **Compute once, render many.** A light cone is *one* computed object —
   a congruence of null geodesics. Its surface, its rays, its wavefronts,
   and its spatial shadow are all *views* of that one object, not separate
   computations. (This single idea replaces the ~6 forked cone files and 3
   spray classes in the inspiration code.)
5. **Small, composable objects.** A metric, a Hamiltonian, an integrator, a
   geodesic, a congruence, a render adapter are different jobs. Wire them
   together; do not fuse them into one class.
6. **One concept, one vocabulary.** Each idea has one canonical name across
   source, tests, docs, and demos.

---

## 3. The mathematical core: general spacetimes via Hamiltonian geodesic flow

### 3.1 A spacetime is a metric in a chart

$$\textbf{Spacetime} = \big(\text{coordinate chart } (x^\mu),\ \text{Lorentzian metric } g_{\mu\nu}(x)\big).$$

Nothing more is assumed. Signature is `(-,+,+,...)`; which slot is time is
recorded so we can pick future-directed null directions. The engine derives
everything else from `g` alone.

### 3.2 Geodesic flow, Hamiltonian form (chosen)

We evolve the canonical state $(x^\mu, p_\mu) \in T^*M$ under

$$H(x,p) = \tfrac12\, g^{\mu\nu}(x)\, p_\mu p_\nu,$$

$$\dot x^\mu = \frac{\partial H}{\partial p_\mu} = g^{\mu\nu}(x)\, p_\nu,
\qquad
\dot p_\lambda = -\frac{\partial H}{\partial x^\lambda} = -\tfrac12\,\big(\partial_\lambda g^{\mu\nu}(x)\big)\, p_\mu p_\nu.$$

- **Null geodesics** are the level set $\{H = 0\}$, preserved by the flow.
  Monitoring $H$ along a trajectory is a coordinate-invariant error meter.
- **Killing symmetries give exactly conserved momenta, manifestly.** For a
  static metric, $\partial_t g = 0 \Rightarrow \dot p_t = 0$: the energy
  $E = -p_t$ is a literal state slot we can read and watch.
- **Velocities are never lost.** For rendering the ray tangents,
  $\dot x^\mu = g^{\mu\nu} p_\nu$.

### 3.3 The Lagrangian alternative, and why we chose against it

The two formulations describe **identical curves**; this is not a physics
choice. It is a choice of *which state vector to evolve*, and three things
follow. The Lagrangian vector field, for comparison, evolves
$(x^\mu, v^\mu) \in TM$ with $v = \dot x$:

$$\dot x^\mu = v^\mu,\qquad
\dot v^\lambda = -\Gamma^\lambda_{\mu\nu}(x)\, v^\mu v^\nu,\qquad
\Gamma^\lambda_{\mu\nu} = \tfrac12 g^{\lambda\sigma}\big(\partial_\mu g_{\sigma\nu} + \partial_\nu g_{\sigma\mu} - \partial_\sigma g_{\mu\nu}\big),$$

linked to the Hamiltonian state by $p_\mu = g_{\mu\nu} v^\nu$.

**Why Hamiltonian:**

1. **Cleaner right-hand side.** The Hamiltonian RHS is two contractions
   with $\partial_\lambda g^{\mu\nu}$. The Lagrangian RHS requires
   assembling the rank-3 Christoffel array (a triple-index sum plus a
   metric inverse). For a diagonal metric like MP the Hamiltonian is a
   three-line closed form; the Christoffel route is markedly more
   index-gymnastics.
2. **Manifest conserved quantities.** Momenta are literal state slots, so
   the energy $E = -p_t$ and the null condition $H$ are one-line readable
   diagnostics. Lagrangian-side these are reconstructed combinations
   $g_{t\nu}v^\nu$.
3. **Symplectic integration is available.** The flow is symplectic on the
   canonical $(x,p)$ phase space, so a structure-preserving integrator
   (implicit midpoint) has *bounded* error in $H$ over long integrations
   rather than secular drift — and, as a Gauss method, conserves
   *quadratic* invariants (e.g. the angular momentum $L = x p_y - y p_x$
   of a single centered hole) exactly, where RK4 drifts. This
   structure-preservation is defined on $T^*M$; it rides in with the
   Hamiltonian form. The Lagrangian-side equivalent (variational
   integrators) exists but is extra machinery we would have to build.

**Honest caveat.** For a *single* non-symplectic integrator like RK4, the
Hamiltonian vs. Lagrangian choice is essentially ergonomics plus which
derivatives you compute — same trajectory, same drift. The genuinely
non-ergonomic payoff (symplectic integration, bounded long-time error)
matters most over long affine ranges; a light cone integrates over a
relatively short range, so the practical trajectory difference here is
modest. We choose Hamiltonian primarily for the RHS ergonomics and the
free diagnostics, with the symplectic option as a welcome bonus and a clean
validation story.

**What we are NOT foreclosing.** The Lagrangian form remains a legitimate
future addition (e.g. variational integrators, or contexts where velocity
is the natural state). The `Integrator` and `VectorField` abstractions do
not assume canonical coordinates, so a Lagrangian path can be added later
without disturbing the core.

### 3.4 What a spacetime must supply

The RHS in §3.2 consumes exactly two things: $g^{\mu\nu}(x)$ and
$\partial_\lambda g^{\mu\nu}(x)$. The spacetime interface is therefore
stated in terms of the **inverse** metric: analytic $g^{\mu\nu}$ and
analytic derivatives where we have them (MP is diagonal; both are
three-line closed forms), with a central-finite-difference fallback for
$\partial g^{\mu\nu}$ derived automatically when a metric supplies only
$g^{\mu\nu}$ itself. This keeps numerical matrix inversion out of the hot
loop entirely; `linalg/`'s LU serves the cold paths — raising/lowering
indices for diagnostics, $v \leftrightarrow p$ conversion, and metrics
specified only covariantly.

---

## 4. Light cones: the structure

### 4.1 One object, many views

The light cone of an event $p$ is a **congruence of null geodesics** — the
future-directed null geodesics emanating from $p$. Naturally parameterized
by

$$(\theta, \lambda) \;\longmapsto\; \gamma_\theta(\lambda),$$

where $\theta$ ranges over emission directions (the infinitesimal null cone
at $p$) and $\lambda$ is the affine parameter along each ray. We integrate
each ray **once**, sampling as we go, producing a strand grid
`grid[θ][λ]`. From that one grid:

- **`.surface`** — the ruled cone surface $(\theta,\lambda)\mapsto$ event,
  as a mesh.
- **`.rays`** — fixed-$\theta$ curves (the light rays / rulings).
- **`.wavefront(t)`** — the constant-**coordinate-time** slice of the
  cone: everywhere the flash has reached by time $t$. This is the lensed
  wavefront of §1 — it folds into caustics at the cut locus, and its lag
  near a hole is the Shapiro delay made visible. It is *not* a
  constant-$\lambda$ curve: with $E = 1$, $dt/d\lambda = U^2$ in MP, so
  affine parameter and coordinate time part company exactly where the
  lensing is interesting. Implementation: $t(\lambda)$ is strictly
  increasing along each ray, so `.wavefront(t)` is a per-ray monotone
  interpolation of the strand grid. (The fixed-$\lambda$ curve stays
  available as `.isochrone(λ)` — a one-liner over the grid, occasionally
  useful, but it is not a wavefront.) Independent check, via §5's
  conformal story: in a static metric the $t$-front is the geodesic
  circle of radius $t$ in the optical metric ($U^4\,\delta_{ij}$ for MP).
- **`.shadow`** — the projection that forgets time, i.e. the spatial trace.

### 4.2 The infinitesimal null cone (coordinate-general sampling)

Initial data lives on the null cone in $T^*_p M$: momenta with
$g^{\mu\nu} p_\mu p_\nu = 0$, restricted to future-directed and normalized
(e.g. $E = -p_t = 1$). Sampling $\theta$ around this quadric *is* choosing
emission angles, and it is honest in any metric and any coordinates. This
replaces the hardcoded `(1, cos θ, sin θ)` of the inspiration code.

### 4.3 Injectable direction sampler

The sampler is a parameter, not a forked file: uniform 360°, a narrow
pencil (an observer's field of view), or a bespoke non-uniform distribution
for a particular shot. This is where the inspiration code's duplication is
dissolved into a single argument.

---

## 5. Coordinates, embedding, and future transformations

- **Metric lives in chart coordinates.** Nothing hardcodes isotropic or any
  other coordinates; "general coordinate systems" is satisfied by letting
  the spacetime carry whatever chart its metric is written in.
- **Embedding is a separate, swappable map** chart-coords → world
  $\mathbb{R}^3$ for rendering (default in 2+1: time is the vertical axis,
  space is the ground plane). The renderer never assumes a particular
  coordinate meaning.
- **Future general features (deferred, but the seams are designed in now):**
  - **Conformal rescaling.** Null geodesics are invariant under
    $g \mapsto \Omega^2 g$. Built as a first-class transformation on
    spacetimes, this lets us regularize or simplify *any* metric before
    integrating. MP's classic "conformal to an ultrastatic metric" trick is
    then a mere *instance* of this general feature, not an MP-specific hack.
  - **Coordinate change for ODEs.** Diffeomorphism pushforward of the
    metric and the flow.
  - Because of these, metric/spacetime objects are designed to be
    **transformable** even though the transforms are not implemented in the
    early phases.

---

## 6. Module layout

```text
lightfall/
  src/
    math/                     # general, reusable mathematics — no physics, no Three.js
      spaces/                 # Space + packed-buffer views (Vec2/Vec3/VecN),
                              #   product / tangent / cotangent bundles, buffer ops
      domains/                # Interval, Box (bounded parameter domains)
      linalg/                 # Matrix, LU solve + inverse (general metrics are not SPD)
      maps/                   # Curve, Surface, VectorField, ScalarField
      numerics/
        integrators/          # Integrator interface, RK4, ImplicitMidpoint (symplectic)
      lorentzian/             # THE GENERAL ENGINE:
                              #   LorentzianManifold (Space + metric + signature),
                              #   geodesicHamiltonian(M) -> H on T*M,
                              #   nullConeAt(M, event) -> initial-momentum sampler
    spacetime/                # concrete spacetimes as metric instances
      majumdar-papapetrou.ts  #   g^{μν} = diag(-U², U⁻², U⁻²), U = 1 + Σ mᵢ/rᵢ
      minkowski.ts            #   flat, for sanity checks
      # (future) schwarzschild.ts, ...
    lightcone/                # LightCone congruence + direction samplers + views
    render/
      three/                  # PolylineObject, SurfaceObject, TubeObject,
                              #   SpacetimeEmbedding (chart -> world)
  demos/                      # Vite-served scenes + a small demo registry
  examples/                   # CLI numerical validations (drift tables, integrator comparison)
  test/                       # one *.test.ts per module, run with `node --test`
  docs/
    plans/                    # this file and other exploratory design notes
    decisions/                # dated, binding architectural decisions
```

Layering rule: `math/` knows nothing about physics; `spacetime/` builds
metrics on `math/lorentzian/`; `lightcone/` consumes a spacetime + an
integrator; `render/` consumes everything and adds Three.js. Dependencies
point strictly downward.

---

## 7. Integrators and validation

Two integrators, both implemented, kept behind the `Integrator` interface so
the light cone is agnostic to which one traces it:

- **RK4** — 4th-order, non-symplectic, the workhorse.
- **ImplicitMidpoint** — symplectic, for the comparison and for long-range
  robustness. It is implicit: each step solves a fixed-point equation
  (a few Picard iterations at these step sizes; the tolerance is a
  parameter of the integrator, not a hidden constant).

**Validation example (CLI, `examples/`):** trace a null geodesic in MP and
tabulate, as functions of affine parameter and step size:

- drift in the null condition $H$ (must stay $\approx 0$) — RK4 drifts
  secularly, ImplicitMidpoint oscillates boundedly;
- drift in the energy $E = -p_t$ — for a static metric the $p_t$
  right-hand side is *identically zero*, so **any** Runge–Kutta method
  conserves $E$ to floating point. Zero drift here is a bug detector for
  the RHS and indexing, not evidence about integrator quality;
- drift in the angular momentum $L = x\,p_y - y\,p_x$ for a **single hole
  at the origin** — a quadratic invariant, conserved exactly by implicit
  midpoint (Gauss method) and not by RK4. This is the sharp side-by-side;
- RK4 vs. ImplicitMidpoint on all of the above.

**Exact-answer checks (single hole, mass $m$, at the origin):**

- **Circular photon orbit.** Extremal Reissner–Nordström has its photon
  sphere at areal radius $2m$; in MP's isotropic-type chart
  ($R = \rho + m$) that is coordinate radius $\rho = m$. A ray launched
  tangentially at $\rho = m$ must stay on that circle.
- **Weak-field deflection.** A ray passing at large impact parameter $b$
  bends by $4m/b$ to leading order.

**Near-hole stiffness.** A hole sits at $r_i = 0$ down an infinite
throat: $U \to \infty$ and $dt/d\lambda = E\,U^2 \to \infty$, so
infalling rays asymptote to the horizon worldtube in $t$ and fixed
$\lambda$-steps lose accuracy exactly there. The drift tables should
include a close-passage ray to make this visible; the termination
predicate (Phase 6) bounds the damage, and adaptive stepping (§11) is
the real fix.

This is both a correctness gate and the honest demonstration of the
Hamiltonian choice from §3.

---

## 8. Rendering

- **Adapters** turn math objects into Three.js scene objects: `PolylineObject`
  (rays, wavefronts, shadow), `SurfaceObject` (the cone), `TubeObject`
  (fattened rays / rims). The cone's apex row is degenerate (every
  $\theta$ maps to the event at $\lambda = 0$): `SurfaceObject` must fan
  it, not quad it.
- **`SpacetimeEmbedding`** is the single place the chart→world map lives —
  swap it to reorient which axis is time.
- **Scene harness** absorbs the lighting / camera / resize / animation-loop
  boilerplate that the inspiration code copy-pasted across every scene.
- Path-traced high-quality stills are out of scope for the early phases;
  the seam (a resolution bump + a different renderer) is noted but not built.

---

## 9. Phased implementation

Each phase ends at a **runnable checkpoint** with tests, so the repo is
always in a working, demonstrable state.

- **Phase 0 — Toolchain scaffold.** `package.json`, strict `tsconfig`,
  `vite.config.ts`, `.gitignore`, `README`, `docs/decisions`. Node runs
  `.ts` directly; `node --test`; Vite for demos; zero runtime deps in the
  math core. *Checkpoint:* `npm run typecheck` passes on an empty source
  tree.

- **Phase 1 — Math foundation.** `spaces/` (Space + Vec views + bundles),
  `domains/`, `linalg/` (Matrix + LU inverse), `maps/` (Curve, Surface,
  VectorField, ScalarField), `numerics/integrators/` (Integrator, RK4,
  ImplicitMidpoint). *Checkpoint:* integrate the harmonic oscillator; tests
  green.

- **Phase 2 — Lorentzian engine.** `math/lorentzian/`:
  `LorentzianManifold`, `geodesicHamiltonian(M)`, `nullConeAt`. Validate on
  **Minkowski** (null geodesics are straight lines; $H$ and $E$ exactly
  conserved). *Checkpoint:* CLI prints straight-line null geodesics.

- **Phase 3 — MP metric + one traced ray.** `spacetime/majumdar-papapetrou`.
  Trace a single null geodesic; run the §7 validation (drift in $H$, $E$;
  RK4 vs. ImplicitMidpoint). *Checkpoint:* the drift table.

- **Phase 4 — Light-cone congruence.** `lightcone/`: the congruence (compute
  once), the injectable direction sampler, and the `.surface` / `.rays` /
  `.wavefront` / `.shadow` views over the strand grid. *Checkpoint:* a cone
  computed and asserted in tests (apex at the event, rays null).

- **Phase 5 — Render + first demo.** `render/three/` adapters +
  `SpacetimeEmbedding` + scene harness; a single-black-hole light-cone demo
  in the browser. *Checkpoint:* `npm run dev` shows a lensed light cone.

- **Phase 6 — Richness.** Multi-hole configurations, more direction
  samplers, wavefronts/caustics highlighted, horizon worldtubes and the
  termination predicate, additional demo scenes. *Checkpoint:* the binary /
  multi-hole scenes from the inspiration code, rebuilt cleanly.

Later, opt-in: the conformal-rescaling / coordinate-change transformations
(§5), the MP conformal shortcut as an *instance* of them, 3+1 exploration,
path-traced stills.

---

## 10. Toolchain

- `type: module`, TypeScript strict (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `allowImportingTsExtensions`, `noEmit`),
  plus `erasableSyntaxOnly` — Node runs `.ts` by *stripping* types, so
  the source must stay inside the erasable subset (no enums, no
  namespaces, no parameter properties).
- Node runs `.ts` sources directly (unflagged type-stripping needs
  Node ≥ 22.18) — no build step for math, tests, or CLI examples.
  Tests: `node --test test/*.test.ts`.
- Vite serves the browser demos; Three.js is confined to `src/render/` and
  `demos/`. Zero runtime dependencies in the `math/` core.
- Pinned like the reference: `typescript ^5.8` (`erasableSyntaxOnly`
  landed in 5.8), `three ^0.184`, `@types/three ^0.184`,
  `@types/node ^22`, `vite ^8`.

Scripts: `typecheck`, `test`, `dev`, `build`.

---

## 11. Open questions and explicitly deferred work

- **Specialization protocol.** How a spacetime overrides the generic flow
  with an exact shortcut (MP's conformal reduction) — deferred until we
  actually need the speed or want it as a validation. The design keeps the
  seam.
- **Conformal / coordinate transformations** (§5) — deferred, seams designed
  in.
- **3+1 spacetimes** — the core is dimension-general; the cone-as-surface is
  2+1-specific. Revisit visualization strategy (slices, projections) if we
  go there.
- **Affine-parameter conventions.** $E = -p_t = 1$ is the normalization,
  and the wavefront is a constant-$t$ resample, not constant-$\lambda$
  (§4.1 — decided). Still open: whether the surface's $\lambda$-axis is
  graded by raw $\lambda$ or reparameterized by $t$ for the nicest mesh.
- **Adaptive step-size control.** Fixed-step RK4/midpoint lose accuracy
  where $U$ blows up near a hole (§7). The drift tables will show where;
  an error-controlled step is the likely answer, alongside the
  termination predicate.
- **Adaptive $\theta$ refinement.** Uniform emission sampling
  under-resolves wavefronts where neighboring rays diverge (near
  caustics). The injectable sampler (§4.3) is the seam;
  refine-where-strands-separate is the likely mechanism.
- **Path-traced stills** — out of scope for now.
