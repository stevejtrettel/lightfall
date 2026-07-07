import { Space } from "../math/spaces/index.ts";
import type { NumericBuffer, SpaceView } from "../math/spaces/index.ts";

// A point of a 2+1 spacetime chart, with time-aware coordinate names
// (t, x, y). This is the fix for the inspiration code's confusion, where a
// bare Vec3's `.x` secretly meant time: here `.t` is time and `.x`, `.y` are
// the spatial plane, explicitly. Structurally it is a 3-component view like
// Vec3, but it reads as coordinates, so `state.pos.t` and `state.mom.x`
// (= p_x) say what they mean.
export class Event implements SpaceView {
  readonly buffer: NumericBuffer;
  readonly offset: number;
  get dimension(): number {
    return 3;
  }

  private constructor(buffer: NumericBuffer, offset: number) {
    this.buffer = buffer;
    this.offset = offset;
  }

  static of(t = 0, x = 0, y = 0): Event {
    return new Event(new Float64Array([t, x, y]), 0);
  }

  static view(buffer: NumericBuffer, offset = 0): Event {
    return new Event(buffer, offset);
  }

  get t(): number {
    return this.buffer[this.offset]!;
  }
  set t(value: number) {
    this.buffer[this.offset] = value;
  }
  get x(): number {
    return this.buffer[this.offset + 1]!;
  }
  set x(value: number) {
    this.buffer[this.offset + 1] = value;
  }
  get y(): number {
    return this.buffer[this.offset + 2]!;
  }
  set y(value: number) {
    this.buffer[this.offset + 2] = value;
  }

  set(t: number, x: number, y: number): this {
    this.buffer[this.offset] = t;
    this.buffer[this.offset + 1] = x;
    this.buffer[this.offset + 2] = y;
    return this;
  }
}

// The 2+1 coordinate chart: time at index 0, spatial plane at indices 1, 2 —
// the layout every 2+1 spacetime in lightfall shares.
export function spacetimeChart(name = "spacetime(2+1)"): Space<Event> {
  return new Space({ name, dimension: 3, viewFactory: Event.view });
}

// The conventional time index for `spacetimeChart`.
export const TIME_INDEX = 0;
