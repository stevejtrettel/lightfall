# Adaptive angular sampling of the light cone

The cone is coarse exactly where it matters (near holes, at caustics) and
over-sampled where it doesn't (the smooth far field). Fix by choosing emission
angles adaptively: seed a coarse ring, then insert rays between neighbors
wherever the surface curves, and iterate.

## Guiding realization

**Adaptive θ is only a change to ray *generation*.** The cone is stored as
rays sorted by angle on a shared λ grid, and the mesh/SVG read adjacency in
θ-order — nothing downstream assumes *uniform* θ. So this is a new sampler that
returns the same `LightCone` (with non-uniform `directions`); the surface mesh,
the SVG, `.wavefront`, everything, are untouched.

## The criterion: relative interpolation error

For an angular gap between rays `lo` and `hi`, trace the **midpoint** ray `mid`
(bisector angle) and compare it to the linear interpolation of its neighbors:

$$\text{err} = \max_j \big\lVert P_{\text{mid}}[j] - \tfrac12(P_{\text{lo}}[j] + P_{\text{hi}}[j]) \big\rVert$$

in intrinsic `(t, x, y)` (not the render embedding — the sampler stays a
math/lightcone concern, independent of `timeScale`). Refine the gap when

$$\text{err} > \varepsilon_{\text{abs}} + \varepsilon_{\text{rel}}\cdot w,\qquad w = \max_j\lVert P_{\text{lo}}[j]-P_{\text{hi}}[j]\rVert\ \text{(ribbon width)}.$$

**Why relative, not absolute — this is the crux.** Even in flat space the
wavefront is a *circle*, so a chord always undercuts the arc by the sagitta
`≈ λ·(Δθ)²/8`, which grows with λ. An absolute tolerance would therefore refine
the boring far field ever more finely with distance. But the sagitta *relative*
to the ribbon width `w ≈ λ·Δθ` is `≈ Δθ/8` — **independent of λ**. So a relative
threshold accepts the trivial circular spreading at a fixed angular resolution
(a modest coarse ring passes) and spends refinement only on the *anomalous*,
non-circular curvature that lensing creates. That is exactly "some directions
don't matter, some matter a lot."

**Plus fate-mismatch (the shadow boundary).** Where `lo` escapes and `hi` is
captured, the ribbon breaks: very different `length`s. That is the critical
curve — the edge of the black-hole shadow, the sharpest feature there is. Force
refinement when `|len_lo − len_hi|` is large and one ray terminated early,
down to the angular floor.

Errors/widths are computed over the **common valid length** `min(len)` of the
strands involved.

## The algorithm: recursive bisection (worst-first per segment)

```
seed:  N₀ uniform rays around the circle, traced          (e.g. N₀ = 24)
for each adjacent pair (incl. the 0↔2π wrap):
    refineGap(lo, hi)

refineGap(lo, hi):
    if (θ_hi − θ_lo) ≤ minAngle:  return            ← caustic / angular floor
    mid = trace( bisector angle )                   ← the test ray
    if err(lo, mid, hi) ≤ εabs + εrel·w(lo,hi)  and not fateMismatch(lo,hi):
        discard mid;  return                        ← surface locally flat: stop
    if keptRays ≥ maxRays:  mark incomplete; return ← budget (no silent caps)
    keep mid
    refineGap(lo, mid);  refineGap(mid, hi)         ← recurse both sides
```

Each traced midpoint is **kept only if it was needed** (the gap curved) and
**discarded if the gap was already flat** — that is what keeps flat-but-spread
far-field regions from over-refining. The cost is one "wasted" trace per
resolved gap (bounded by the final ray count); a second-difference proxy over
existing rays is a documented future optimization if that ever bites.

Depth is shallow (`log₂(2π/N₀ / minAngle) ≈ 8`), so plain recursion is fine.

## Knobs (all defaulted, all documented)

- `initialRays` (N₀), default 24 — seeds the topology; enough that no hole is
  missed between two initial rays.
- `toleranceRel` (εrel), default ~0.15 — the far-field faceting tolerance; the
  main quality dial.
- `toleranceAbs` (εabs), default 0 — a floor so true caustics (where `w → 0`)
  don't demand infinite relative accuracy.
- `minAngle`, default `2π/2048` — the hard angular floor at folds.
- `maxRays`, default ~3000 — budget; if hit before convergence, report it.
- fate-mismatch sample threshold, default a few samples.

## Data flow and refactor

- **`RayTracer`** (`lightcone/trace.ts`) — bundles `{system, method, nullcone,
  phase, lambdas, scratch}` and exposes `trace(θ) → Strand`, where
  `Strand = { positions: Float64Array(samples·3), length }`. This is the
  per-ray work currently inline in `lightCone`, factored out.
- **`assembleCone(manifold, event, thetas, strands, lambdas) → LightCone`** —
  packs sorted strands into the grid. Used by both samplers.
- **`lightCone`** — refactored to `RayTracer` + `assembleCone` over uniform
  angles (behavior unchanged).
- **`adaptiveLightCone` / `adaptiveDirections`** (`lightcone/adaptive.ts`) — the
  refinement above; returns a `LightCone` (and a small `converged` report).
- `lightCone` (uniform) stays — it's the simplest case and the validation
  baseline.

## Subtleties, and how each is handled

- **Trivial circular spreading** → relative tolerance (above).
- **Caustics won't converge** → `minAngle` floor + `maxRays` (Phase A); the
  principled Jacobian-based stop is Phase B.
- **Shadow boundary** → fate-mismatch force-refine.
- **θ is a circle** → the wrap pair is refined like any other; inserted angles
  reduced mod 2π.
- **Apex over-sampling** → refining adds whole rays (all λ), so the apex gets
  extra coincident rays; cheap, and it keeps the clean rectangular grid instead
  of a T-junction 2D mesh. Accepted.
- **No silent caps** → hitting `maxRays` sets `converged = false` in the report.

## Phase B (deferred): caustics done right

Compute the areal Jacobian `J = ∂(x,y)/∂(θ,λ)` by finite differences across the
grid. `J` vanishes and flips sign at a fold caustic, which (a) gives a
principled caustic **stop** replacing the blunt `minAngle` floor, and (b) yields
the **caustic curve** (`J = 0`) as a drawable feature — the bright cusps. Also
the honest backbone: separation is a Jacobi field, caustics are conjugate
points. Build after Phase A is working.

## Testing / validation

- **Output-quality test**: after adaptive sampling, adjacent-ray ribbon widths
  are bounded, ray density is concentrated near the hole (more rays in the
  lensed angular sector than in the far field), no NaNs, `directions` sorted.
- **Convergence test**: with a generous budget, `converged = true` and every
  final gap's interpolation error is under tolerance.
- **Baseline parity**: a huge-tolerance adaptive run ≈ the coarse uniform cone.
- **Eyeball**: SVG of uniform vs. adaptive at equal ray budget — the adaptive
  one is smooth at the caustics where the uniform one is faceted.

## Decisions locked

Relative interpolation-error criterion in `(t,x,y)`; recursive bisection,
worst-first per segment; both stop rules (`minAngle` + `maxRays`);
fate-mismatch on; keep the uniform `lightCone`; caustic-curve extraction is
Phase B.
