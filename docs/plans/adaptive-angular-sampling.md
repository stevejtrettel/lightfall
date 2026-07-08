# Adaptive angular sampling of the light cone

The cone is coarse exactly where it matters (near holes, at the shadow edge, in
the strongly-lensed fans) and over-sampled where it doesn't (the smooth far
field). Fix by choosing emission angles adaptively: seed a coarse ring, then
spend a ray budget splitting the *worst* gap first, until the budget runs out.

## Guiding realization

**Adaptive θ is only a change to ray *generation*.** The cone is stored as rays
sorted by angle on a shared λ grid, and the mesh/SVG read adjacency in θ-order —
nothing downstream assumes *uniform* θ. So this is a sampler that returns the
same `LightCone` (with non-uniform `directions`); the surface mesh, the SVG,
`.wavefront`, everything, are untouched.

## What "worst" means: three criteria, worst-first

For an angular gap between rays `lo` and `hi` we trace the **midpoint** ray
(bisector angle) and score the gap by the largest of three ratios, each ≥ 1
meaning "needs splitting". The global refinement always splits the highest-
scoring gap next (a max-heap), so a fixed ray budget lands where it matters most.

### 1. Curvature (surface-flatness sag) — `sagError / sagTol`

Compare the midpoint to the linear interpolation of its neighbours, over the
**common valid extent** (no padding — see subtleties):

$$\text{sag} = \max_j \big\lVert P_{\text{mid}}[j] - \tfrac12(P_{\text{lo}}[j] + P_{\text{hi}}[j]) \big\rVert,\qquad \text{ratio} = \frac{\text{sag}}{\text{sagTol}}.$$

in intrinsic `(t, x, y)` (not the render embedding — the sampler stays a
math/lightcone concern, independent of `timeScale`). `sagTol` is an **absolute**
world-unit tolerance; `buildCone` scales it from a fraction of `lambdaMax`, so it
stays scale-invariant across zoom without being relative *per gap*.

**Why absolute, not per-gap relative — this is the crux (and it was wrong before).**
The original criterion normalized the sag by each gap's *own* ribbon width
`w ≈ λ·Δθ`, giving `sag/w ≈ Δθ/8` — a ratio that is the same for the empty sky
and the lensed core. That looked elegant (scale-free, λ-independent) but it makes
the criterion *blind to where the interesting curvature is*: the trivial circular
spreading of the far field scores exactly like a real lens. So tightening the
tolerance to resolve the hole **floods the boring sky in lockstep** — measured,
going from `toleranceRel` 0.15 → 0.004 pushed the empty-sky sector from ~11 to
~127 rays while the hole barely moved. An **absolute** sagTol fixes this: the
sky's sag is absolutely small and satisfied early; the lens's sag stays large and
keeps refining. The two decouple — you can sharpen the lens without paying for
the sky.

### 2. Fate mismatch (the shadow boundary) — priority ∞

Where `lo` escapes and `hi` is captured, the ribbon breaks: very different
`length`s. That is the critical curve, the edge of the shadow, the sharpest
feature present. It scores ∞ so it is always split first, down to `minAngle`.
It also stands in for the length criteria across a genuine discontinuity, where
the surface *tears* and no triangle can span it — the size test below is not
even evaluated there.

### 3. Element size (even sampling, the stretched-thin fans) — `edgeSpan / edgeTol`

Criterion 1 misses a whole failure mode: two neighbours can drift far apart while
the surface between them stays essentially *planar* (a big flat triangle), so the
sag is ~0 and no `sagTol` touches it. Geodesic deviation only grows once rays
separate, so in a black-hole spacetime these fans keep spreading — and they are
exactly the visible, un-trimmed surface. This is also the **even-sampling** knob:
bounding the neighbour separation bounds triangle size everywhere.

Score `edgeSpan / edgeTol`, the largest neighbour separation against an absolute
world-unit cap:

$$\text{edgeSpan} = \max_{j < \min(\text{len}_{\text{lo}},\text{len}_{\text{hi}})}\lVert P_{\text{lo}}[j]-P_{\text{hi}}[j]\rVert.$$

Measured over the **common valid extent**, so an absorbed ray contributes only its
real, pre-absorption geometry; its frozen padded tail is ignored. Across a fate
boundary the size test is skipped (criterion 2 owns it), so this never wastes rays
chasing the irreducible tear at the shadow edge.

## The algorithm: global worst-first, budget-driven

```
seed:  N₀ uniform rays around the circle, traced        (e.g. N₀ = 40)
heap ← one Gap per adjacent pair (incl. the 0↔2π wrap), each with a traced midpoint
while heap not empty:
    g = heap.pop()                     ← globally worst gap
    if g.priority ≤ 1:      break      ← nothing exceeds any criterion: done
    if g.width ≤ minAngle:  continue   ← angular floor: leave it, take the next
    if kept ≥ maxRays:      break, mark incomplete   ← budget (no silent caps)
    keep g.mid;  push Gap(lo,mid), Gap(mid,hi)        ← each traces its own midpoint
```

A traced midpoint is kept only when its gap was the worst and still exceeded a
criterion; the cost is one "wasted" trace per resolved gap.

**Two regimes, same loop.** With *loose* tolerances and the default floor, the
heap converges — it stops when every gap is under both `sagTol` and `edgeTol`.
With *tight* tolerances and a *deep* `minAngle` it never converges, so it becomes
a pure **budget-driven fill**: every ray in `maxRays` goes to the current widest
gap. The demo uses the second regime — the "ray budget" slider *is* `maxRays` —
which is why raising it always fills the most stretched-thin regions (shadow edge,
lensed fans) first rather than refining uniformly.

## Knobs (all defaulted)

- `initialRays` (N₀) — seeds the topology; enough that no hole is missed between
  two initial rays.
- `sagTol` — absolute surface-flatness tolerance (chord deviation, world units).
  Resolves lensing/caustic folds. Sharpening it does **not** touch the calm sky.
- `edgeTol` — absolute element-size tolerance (neighbour separation, world units).
  Sets the even-sampling density and fills the stretched-thin fans.
- `minAngle` — hard angular floor on gap width. The default `2π/2048` is too
  shallow for the photon sphere; the demo drops it far lower so the size test can
  keep subdividing the shadow edge.
- `maxRays` — ray budget; in the budget-driven regime this is the primary dial.
- `fateSamples` — length-mismatch threshold for the shadow boundary.

`buildCone` (`quality.ts`) exposes `sagTol`/`edgeTol` in the preset as *fractions
of `lambdaMax`* and multiplies through, so a preset reads the same at any scene
scale.

## Data flow

- **`RayTracer`** (`lightcone/trace.ts`) — `trace(θ) → Strand`, where
  `Strand = { positions: Float64Array(samples·3), length }` (padded past
  termination with the last point).
- **`assembleCone(manifold, event, thetas, strands, lambdas) → LightCone`** —
  packs sorted strands into the grid. Used by both samplers.
- **`lightCone`** (uniform) — `RayTracer` + `assembleCone` over uniform angles;
  kept as the simplest case and the validation baseline.
- **`adaptiveLightCone` / `adaptiveDirections`** (`lightcone/adaptive.ts`) — the
  refinement above; returns a `LightCone` and a small `converged` report.

## Subtleties, and how each is handled

- **Trivial circular spreading** → evenly sampled by `edgeTol` alone; the sag test
  ignores it (a circle's absolute sag is small and satisfied early), so tightening
  `sagTol` for the lens leaves it untouched.
- **Smoothly-diverging lensed fans** → element-size test (`edgeSpan / edgeTol`).
- **Shadow boundary** → fate-mismatch, priority ∞.
- **θ is a circle** → the wrap pair is refined like any other; inserted angles
  reduced mod 2π.
- **Apex over-sampling** → refining adds whole rays (all λ), so the apex gets
  extra coincident rays; cheap, and it keeps the clean rectangular grid instead
  of a T-junction mesh. Accepted.
- **Padded strand tails are fake geometry** → both length criteria measure over
  the *common valid extent* (`min` of the strand lengths), never the points a
  strand is padded with after it terminates. The old curvature test used the full
  padded extent and so scored partly on frozen points; the fate test (∞) already
  refines wherever lengths diverge, so the honest window loses nothing there.
- **The photon-sphere edge is a genuine log singularity.** The endpoint gap there
  shrinks only logarithmically with each bisection, so the worst gap plateaus at
  a few units no matter the budget — a real caustic, not a sampling bug. The
  floor bounds the chase; `minAngle` is where we stop.
- **No silent caps** → hitting `maxRays` sets `converged = false`.

## Deferred: caustics via the Jacobian

Compute the areal Jacobian `J = ∂(x,y)/∂(θ,λ)` by finite differences across the
grid (see `caustics.ts`). `J` vanishes and flips sign at a fold, giving both a
principled caustic **stop** and the **caustic curve** (`J = 0`) as a drawable
feature. The honest backbone: separation is a Jacobi field, caustics are
conjugate points.

## Testing / validation

- Adaptive sampling stays sorted, no NaNs, concentrates toward the hole.
- Huge tolerances ≈ the seed ring; flat space refines *evenly* (size-driven).
- **Tightening `sagTol` resolves the lens without flooding the sky** — the
  regression test for the fix above (hole densifies ~2.7×, sky holds flat).
- `edgeTol` drives the even-sampling density everywhere, the sky included.
- Budget worst-first: with a deep floor, more rays shrink the worst escaping edge.
