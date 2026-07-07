import { Space } from "./space.ts";
import type { NumericBuffer, SpaceView } from "./space.ts";

// Fixed-size ergonomic views with named coordinate access, plus a
// runtime-sized `Vector` for solver work. Each view has two construction
// paths, kept honest by a private constructor:
//
//   Vec3.of(x, y, z)          — allocate fresh storage (authoring / tests)
//   Vec3.view(buffer, offset) — alias existing storage (product parts, pools)
//
// The `.view` form is what a Space's viewFactory calls, so these types drop
// straight into product spaces and bundles.

export class Vec2 implements SpaceView {
  readonly buffer: NumericBuffer;
  readonly offset: number;
  get dimension(): number {
    return 2;
  }

  private constructor(buffer: NumericBuffer, offset: number) {
    this.buffer = buffer;
    this.offset = offset;
  }

  static of(x = 0, y = 0): Vec2 {
    return new Vec2(new Float64Array([x, y]), 0);
  }

  static view(buffer: NumericBuffer, offset = 0): Vec2 {
    return new Vec2(buffer, offset);
  }

  get x(): number {
    return this.buffer[this.offset]!;
  }
  set x(value: number) {
    this.buffer[this.offset] = value;
  }
  get y(): number {
    return this.buffer[this.offset + 1]!;
  }
  set y(value: number) {
    this.buffer[this.offset + 1] = value;
  }

  set(x: number, y: number): this {
    this.buffer[this.offset] = x;
    this.buffer[this.offset + 1] = y;
    return this;
  }
}

export class Vec3 implements SpaceView {
  readonly buffer: NumericBuffer;
  readonly offset: number;
  get dimension(): number {
    return 3;
  }

  private constructor(buffer: NumericBuffer, offset: number) {
    this.buffer = buffer;
    this.offset = offset;
  }

  static of(x = 0, y = 0, z = 0): Vec3 {
    return new Vec3(new Float64Array([x, y, z]), 0);
  }

  static view(buffer: NumericBuffer, offset = 0): Vec3 {
    return new Vec3(buffer, offset);
  }

  get x(): number {
    return this.buffer[this.offset]!;
  }
  set x(value: number) {
    this.buffer[this.offset] = value;
  }
  get y(): number {
    return this.buffer[this.offset + 1]!;
  }
  set y(value: number) {
    this.buffer[this.offset + 1] = value;
  }
  get z(): number {
    return this.buffer[this.offset + 2]!;
  }
  set z(value: number) {
    this.buffer[this.offset + 2] = value;
  }

  set(x: number, y: number, z: number): this {
    this.buffer[this.offset] = x;
    this.buffer[this.offset + 1] = y;
    this.buffer[this.offset + 2] = z;
    return this;
  }
}

// Runtime-sized view for dimension-general work (matrix rows/columns, solver
// vectors). No named accessors — index with `get(i)` / `setComponent(i, v)`.
export class Vector implements SpaceView {
  readonly buffer: NumericBuffer;
  readonly offset: number;
  readonly dimension: number;

  private constructor(buffer: NumericBuffer, offset: number, dimension: number) {
    this.buffer = buffer;
    this.offset = offset;
    this.dimension = dimension;
  }

  static zeros(n: number): Vector {
    return new Vector(new Float64Array(n), 0, n);
  }

  static of(...components: number[]): Vector {
    return new Vector(Float64Array.from(components), 0, components.length);
  }

  static view(buffer: NumericBuffer, offset: number, dimension: number): Vector {
    return new Vector(buffer, offset, dimension);
  }

  get(i: number): number {
    if (i < 0 || i >= this.dimension) {
      throw new RangeError(`Vector index ${i} out of range [0, ${this.dimension})`);
    }
    return this.buffer[this.offset + i]!;
  }

  setComponent(i: number, value: number): this {
    if (i < 0 || i >= this.dimension) {
      throw new RangeError(`Vector index ${i} out of range [0, ${this.dimension})`);
    }
    this.buffer[this.offset + i] = value;
    return this;
  }
}

export function vec2Space(name = "R²"): Space<Vec2> {
  return new Space({ name, dimension: 2, viewFactory: Vec2.view });
}

export function vec3Space(name = "R³"): Space<Vec3> {
  return new Space({ name, dimension: 3, viewFactory: Vec3.view });
}

export function realSpace(n: number, name = `R^${n}`): Space<Vector> {
  return new Space({
    name,
    dimension: n,
    viewFactory: (buffer, offset) => Vector.view(buffer, offset, n),
  });
}
