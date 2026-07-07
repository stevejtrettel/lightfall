import type { SpaceView } from "./space.ts";

// Allocation-free elementwise kernels over packed views. These are the raw
// primitives the arithmetic layers build on: `linalg/`'s VectorSpace wraps
// them into the Integrator-facing interface, and integrators call them in
// their hot loops. They read and write through `buffer`/`offset`, so aliasing
// works (e.g. `addScaledInto(state, dt, state)` is a valid doubling).
//
// Contract: all views share a common dimension; the caller guarantees it.
// These kernels do not check — they are the fast path, and a mismatch is a
// bug in the layer above, caught by that layer's own invariants and tests.

export function copyInto(out: SpaceView, src: SpaceView): void {
  const o = out.buffer;
  const s = src.buffer;
  const oo = out.offset;
  const so = src.offset;
  for (let i = 0; i < out.dimension; i += 1) o[oo + i] = s[so + i]!;
}

export function zeroInto(out: SpaceView): void {
  const o = out.buffer;
  const oo = out.offset;
  for (let i = 0; i < out.dimension; i += 1) o[oo + i] = 0;
}

// out *= s
export function scaleInto(out: SpaceView, s: number): void {
  const o = out.buffer;
  const oo = out.offset;
  for (let i = 0; i < out.dimension; i += 1) o[oo + i] = o[oo + i]! * s;
}

// out += s · src
export function addScaledInto(out: SpaceView, s: number, src: SpaceView): void {
  const o = out.buffer;
  const b = src.buffer;
  const oo = out.offset;
  const bo = src.offset;
  for (let i = 0; i < out.dimension; i += 1) o[oo + i] = o[oo + i]! + s * b[bo + i]!;
}
