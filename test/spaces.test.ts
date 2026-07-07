import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Space,
  Vec2,
  Vec3,
  Vector,
  vec3Space,
  productSpace,
  cotangentBundle,
  copyInto,
  addScaledInto,
  scaleInto,
} from "../src/math/spaces/index.ts";

test("Space.create returns an initialized, independently-backed view", () => {
  const R3 = vec3Space();
  const a = R3.create((v) => v.set(1, 2, 3));
  const b = R3.create();
  assert.deepEqual([a.x, a.y, a.z], [1, 2, 3]);
  assert.deepEqual([b.x, b.y, b.z], [0, 0, 0]);
  a.x = 99;
  assert.equal(b.x, 0, "distinct elements do not share backing storage");
});

test("Space.view aliases existing storage and bounds-checks", () => {
  const R3 = vec3Space();
  const buffer = new Float64Array([10, 20, 30, 40, 50, 60]);
  const second = R3.view(buffer, 3);
  assert.deepEqual([second.x, second.y, second.z], [40, 50, 60]);
  second.y = 0;
  assert.equal(buffer[4], 0, "writing the view writes the shared buffer");
  assert.throws(() => R3.view(buffer, 4), RangeError, "offset 4 + dim 3 overruns length 6");
});

test("Vec2/Vec3 named access; of allocates, view aliases", () => {
  const p = Vec3.of(1, 2, 3);
  assert.deepEqual([p.x, p.y, p.z], [1, 2, 3]);

  const shared = new Float64Array([7, 8]);
  const q = Vec2.view(shared, 0);
  q.set(-1, -2);
  assert.deepEqual([shared[0], shared[1]], [-1, -2]);
});

test("Vector is runtime-sized with checked indexing", () => {
  const v = Vector.of(4, 5, 6, 7);
  assert.equal(v.dimension, 4);
  assert.equal(v.get(2), 6);
  v.setComponent(3, 0);
  assert.equal(v.get(3), 0);
  assert.throws(() => v.get(4), RangeError);
});

test("productSpace lays parts out contiguously and aliases them live", () => {
  const R3 = vec3Space();
  const P = productSpace({ a: R3, b: R3 }, { name: "R³ × R³" });
  assert.equal(P.dimension, 6);

  const s = P.create((s) => {
    s.a.set(1, 2, 3);
    s.b.set(4, 5, 6);
  });
  // parts write into one contiguous buffer, a then b
  assert.deepEqual(Array.from(s.buffer), [1, 2, 3, 4, 5, 6]);

  // mutating the flat buffer is seen through the parts
  s.buffer[4] = 500;
  assert.equal(s.b.y, 500);
});

test("cotangentBundle exposes pos/mom over one packed state", () => {
  const chart = vec3Space("spacetime(2+1)");
  const phase = cotangentBundle(chart);
  assert.equal(phase.dimension, 6);
  assert.equal(phase.name, "T*spacetime(2+1)");

  const state = phase.create((s) => {
    s.pos.set(0, -20, 5); // (t, x, y)
    s.mom.set(-1, 1, 0); //  (p_t, p_x, p_y)
  });
  assert.equal(state.pos.y, -20);
  assert.equal(state.mom.x, -1);
});

test("buffer-ops kernels are in-place and alias-safe", () => {
  const R3 = vec3Space();
  const a = R3.create((v) => v.set(1, 2, 3));
  const b = R3.create((v) => v.set(10, 10, 10));

  addScaledInto(a, 2, b); // a += 2·b
  assert.deepEqual([a.x, a.y, a.z], [21, 22, 23]);

  scaleInto(a, 0.5);
  assert.deepEqual([a.x, a.y, a.z], [10.5, 11, 11.5]);

  addScaledInto(a, 1, a); // aliasing: a += a  ⇒  doubles
  assert.deepEqual([a.x, a.y, a.z], [21, 22, 23]);

  copyInto(a, b);
  assert.deepEqual([a.x, a.y, a.z], [10, 10, 10]);
});

test("Space rejects a non-positive dimension", () => {
  assert.throws(
    () => new Space({ dimension: 0, viewFactory: Vec3.view }),
    RangeError,
  );
});
