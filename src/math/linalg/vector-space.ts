import type { Space, SpaceView } from "../spaces/index.ts";
import {
  addScaledInto,
  copyInto,
  scaleInto,
  zeroInto,
} from "../spaces/index.ts";

// The standard R-linear structure on a Space: create / copy / scale /
// add-scaled — the operations that advance and combine states. A Space is
// only a layout; this is the arithmetic laid on top of it, and it is what an
// `Integrator` consumes to step, snapshot, and blend states. Other structures
// (a metric, an inner product) are laid on separately, by their own modules.
//
// Every method is allocation-free except `create`, and delegates to the
// `buffer-ops` kernels — so the whole integrator hot loop runs over packed
// buffers with no per-step allocation.
export interface VectorSpace<V extends SpaceView> {
  readonly space: Space<V>;
  create(): V;
  copy(out: V, src: V): void;
  zero(out: V): void;
  scale(out: V, s: number): void; // out *= s
  addScaled(out: V, s: number, src: V): void; // out += s · src
}

export function vectorSpaceOf<V extends SpaceView>(
  space: Space<V>,
): VectorSpace<V> {
  return {
    space,
    create: () => space.create(),
    copy: copyInto,
    zero: zeroInto,
    scale: scaleInto,
    addScaled: addScaledInto,
  };
}
