// The one primitive everything is packed into. Doubles throughout: the math
// computes in full precision, and only render-facing storage ever steps down
// to Float32 (at the adapter boundary, never here).
export type NumericBuffer = Float64Array;

// A view is a typed window onto a slice of a NumericBuffer. It owns no
// storage: `buffer` and `offset` locate its `dimension` components inside
// shared backing memory, and every read/write goes straight through. Many
// views can therefore alias one buffer — a product state and its parts, a
// pooled arena and its slots — which is what makes packed, allocation-free
// state possible while the authoring code still reads like `state.pos.x`.
export interface SpaceView {
  readonly buffer: NumericBuffer;
  readonly offset: number;
  readonly dimension: number;
}

// How a Space turns backing storage into a typed view.
export type ViewFactory<V extends SpaceView> = (
  buffer: NumericBuffer,
  offset: number,
) => V;

// Strip `readonly` so a factory can assign once to otherwise-immutable view
// fields. Used where a view is built imperatively rather than via `new`.
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface SpaceOptions<V extends SpaceView> {
  name?: string;
  dimension: number;
  viewFactory: ViewFactory<V>;
}

// A Space is a *layout*, nothing more: how many doubles an element occupies
// and how to view them. It carries no mathematical structure of its own — a
// length-3 Space could be a Euclidean point, a spacetime event, or a row of a
// matrix. Structure (a vector-space arithmetic, a metric) is layered on top by
// other modules; the user picks the structure that matches the problem. See
// docs/plans/implementation-plan.md §2.3.
export class Space<V extends SpaceView = SpaceView> {
  readonly name: string;
  readonly dimension: number;
  readonly viewFactory: ViewFactory<V>;

  constructor(options: SpaceOptions<V>) {
    const { name, dimension, viewFactory } = options;
    if (!Number.isInteger(dimension) || dimension <= 0) {
      throw new RangeError(
        `Space needs a positive integer dimension, got ${dimension}`,
      );
    }
    this.name = name ?? `Space(${dimension})`;
    this.dimension = dimension;
    this.viewFactory = viewFactory;
  }

  // Wrap existing backing storage at `offset` as a typed view. Use this to
  // sub-view a packed buffer (a product state's parts) or to reinterpret a
  // slot in a pooled arena. Bounds-checked; not a hot path (integrators view
  // their working states once at construction, then mutate buffers directly).
  view(buffer: NumericBuffer, offset = 0): V {
    if (offset < 0 || offset + this.dimension > buffer.length) {
      throw new RangeError(
        `${this.name}: cannot view ${this.dimension} components at offset ${offset} ` +
          `of a length-${buffer.length} buffer`,
      );
    }
    return this.viewFactory(buffer, offset);
  }

  // Allocate a fresh element on its own backing buffer and return a view onto
  // it. `init` runs against the new view for in-place setup:
  //
  //   const s = phase.create((s) => { s.pos.set(t, x, y); s.mom.set(e, px, py); });
  create(init?: (view: V) => void): V {
    const view = this.viewFactory(new Float64Array(this.dimension), 0);
    if (init !== undefined) init(view);
    return view;
  }
}
