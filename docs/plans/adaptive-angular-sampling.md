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

### 1. Curvature (relative interpolation error)

Compare the midpoint to the linear interpolation of its neighbours:

$$\text{err} = \max_j \big\lVert P_{\text{mid}}[j] - \tfrac12(P_{\text{lo}}[j] + P_{\text{hi}}[j]) \big\rVert,\qquad \text{ratio} = \frac{\text{err}}{\varepsilon_{\text{rel}}\, w},\quad w = \max_j\lVert P_{\text{lo}}[j]-P_{\text{hi}}[j]\rVert.$$

in intrinsic `(t, x, y)` (not the render embedding — the sampler stays a
math/lightcone concern, independent of `timeScale`).

**Why relative, not absolute — this is the crux.** Even in flat space the
wavefront is a *circle*, so a chord undercuts the arc by the sagitta
`≈ λ·(Δθ)²/8`, which grows with λ. An absolute tolerance would refine the boring
far field ever more finely with distance. But the sagitta *relative* to the
ribbon width `w ≈ λ·Δθ` is `≈ Δθ/8` — **independent of λ**. So the relative
threshold accepts trivial circular spreading at a fixed angular resolution and
spends refinement only on the *anomalous* curvature lensing creates.

### 2. Fate mismatch (the shadow boundary) — priority ∞

Where `lo` escapes and `hi` is captured, the ribbon breaks: very different
`length`s. That is the critical curve, the edge of the shadow, the sharpest
feature present. It scores ∞ so it is always split first, down to `minAngle`.

### 3. Endpoint separation (the stretched-thin fans) — the key addition

Criteria 1–2 miss a whole failure mode: two **escaping** neighbours can drift far
apart while the surface between them stays essentially *planar* (a big flat
triangle), so curvature is ~0 and no amount of tolerance touches it. Geodesic
deviation only grows once rays separate, so in a black-hole spacetime these fans
keep spreading — and they are exactly the visible, un-trimmed surface.

So: for two escaping neighbours, also score `endpointSep / maxEscapeGap`, the
distance between their final points against an absolute cap. **Absorbed rays are
excluded** — their endpoints pile onto the horizon tube and get trimmed away, so
refining between them is wasted (this is why "turn up detail" used to dump rays
into plunging geodesics that never showed).

Measured over the **full padded extent** of the strands, not the common valid
length: the divergence that matters is at large λ, near the hole, exactly where
a `min(len)` window would clip it out.

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

**Two regimes, same loop.** With a *loose* `maxEscapeGap` (or none) and the
default floor, the heap converges — it stops when every gap is under tolerance.
With a *tiny* `maxEscapeGap` and a *deep* `minAngle` it never converges, so it
becomes a pure **budget-driven fill**: every ray in `maxRays` goes to the current
widest gap. The demo uses the second regime — the "ray budget" slider *is*
`maxRays` — which is why raising it always fills the most stretched-thin regions
(shadow edge, lensed fans) first rather than refining uniformly.

## Knobs (all defaulted)

- `initialRays` (N₀) — seeds the topology; enough that no hole is missed between
  two initial rays.
- `toleranceRel` (εrel) — curvature tolerance vs. ribbon width.
- `minAngle` — hard angular floor on gap width. The default `2π/2048` is too
  shallow for the photon sphere; the demo drops it far lower so the endpoint cap
  can keep subdividing the shadow edge.
- `maxRays` — ray budget; in the budget-driven regime this is the primary dial.
- `maxEscapeGap` — absolute endpoint-separation cap for escaping neighbours; off
  (undefined) ⇒ curvature + fate only.
- `fateSamples` — length-mismatch threshold for the shadow boundary.

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

- **Trivial circular spreading** → relative curvature tolerance.
- **Smoothly-diverging lensed fans** → endpoint-separation cap (escaping only).
- **Shadow boundary** → fate-mismatch, priority ∞.
- **θ is a circle** → the wrap pair is refined like any other; inserted angles
  reduced mod 2π.
- **Apex over-sampling** → refining adds whole rays (all λ), so the apex gets
  extra coincident rays; cheap, and it keeps the clean rectangular grid instead
  of a T-junction mesh. Accepted.
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
- Flat space barely refines (relative tolerance accepts the circle); a huge
  tolerance ≈ the seed ring.
- Tightening `toleranceRel` adds rays in the lensed cone and still converges.
- The endpoint cap shrinks the worst escaping-endpoint gap and adds rays in the
  fans (not between absorbed rays).
