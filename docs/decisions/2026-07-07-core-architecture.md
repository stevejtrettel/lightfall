# Core architecture

**Date:** 2026-07-07
**Status:** accepted

Binding commitments for lightfall. Rationale and detail live in
[`../plans/implementation-plan.md`](../plans/implementation-plan.md); this
record states only what is decided. Decisions describe commitments — source
code follows them.

1. **Self-contained ownership.** Lightfall owns 100% of its code. `math-lab`
   and `charged-blackholes` are inspiration only; there is no vendored layer
   and no provenance boundary.

2. **A spacetime is a metric in a chart.** The general engine assumes nothing
   beyond a coordinate chart and a Lorentzian metric `g` (signature
   `(-,+,+,…)`, time slot recorded). Concrete spacetimes (MP, Minkowski, …)
   are metric instances plugged into that engine.

3. **Geodesic flow is Hamiltonian.** We evolve the canonical state `(x, p)`
   on `T*M` under `H = ½ gᵘᵛ(x) pᵤ pᵥ`. Null geodesics are `{H = 0}`.
   Chosen over the equivalent Lagrangian (`TM`, Christoffel) form for RHS
   ergonomics, manifest conserved momenta, and the availability of symplectic
   integration. The Lagrangian path is not foreclosed; the `Integrator` /
   `VectorField` abstractions do not assume canonical coordinates.

4. **The spacetime interface is stated on the inverse metric.** It supplies
   `gᵘᵛ(x)` and `∂gᵘᵛ(x)` — analytic where available, central-finite-
   difference fallback otherwise. Matrix inversion (LU) stays out of the hot
   loop, on cold paths only (index raising/lowering, `v ↔ p`, covariantly
   specified metrics).

5. **Compute once, render many.** A light cone is a single congruence of null
   geodesics (a strand grid). Its `.surface`, `.rays`, `.wavefront(t)`, and
   `.shadow` are views of that one object. The emission-direction sampler is
   an injected parameter, not a forked file.

6. **The wavefront is a constant-coordinate-time slice**, resampled per ray
   by monotone `t(λ)` — not a constant-`λ` curve. (`.isochrone(λ)` remains
   available as the constant-`λ` view.)

7. **Two integrators, kept behind one interface.** RK4 and a symplectic
   implicit-midpoint, so the light cone is agnostic to which traces it and so
   the integrator comparison (quadratic-invariant `L` conservation) is
   honest.

8. **Coordinates and embedding are separate.** The metric lives in its chart;
   a swappable `SpacetimeEmbedding` maps chart coordinates → world `ℝ³` for
   rendering. Conformal rescaling and coordinate change are designed-in seams,
   deferred; MP's conformal-to-ultrastatic trick will be an instance of the
   general feature, not a special case.

9. **Primary target is 2+1.** The math core is dimension-general; the
   cone-as-surface and the rendering layer target the 2+1 slice, which is an
   exact totally-geodesic slice of the 3+1 solution.

10. **Toolchain: Node type-stripping, no build step.** Strict TypeScript with
    `erasableSyntaxOnly`; source stays in the erasable subset. `math/` has
    zero runtime dependencies; Three.js is confined to `src/render/` and
    `demos/`.
