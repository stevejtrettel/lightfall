import { test } from "node:test";
import assert from "node:assert/strict";

import { majumdarPapapetrou, Event } from "../src/spacetime/index.ts";
import { lightCone, uniformDirections, absorbedNear } from "../src/lightcone/index.ts";
import { ConeMesh, timeUp } from "../src/render/three/index.ts";

// Three.js geometry construction needs no WebGL, so we can validate the mesh
// (the risky part — fan/seam/tearing/embedding) in node, without a browser.
test("ConeMesh builds a finite, indexed, torn geometry", () => {
  const holes = [{ mass: 1, x: 0, y: 0 }];
  const M = majumdarPapapetrou(holes);
  const cone = lightCone(M, Event.of(0, 0, -5), {
    directions: uniformDirections(60),
    samples: 80,
    step: 0.08,
    maxRadius: 12,
    terminate: absorbedNear(holes, 0.35),
  });

  const mesh = new ConeMesh(cone, { embedding: timeUp(0.8) });
  const pos = mesh.geometry.getAttribute("position");
  assert.equal(pos.count, cone.rayCount * cone.sampleCount, "one vertex per grid node");
  for (let k = 0; k < pos.array.length; k += 1) {
    assert.ok(Number.isFinite(pos.array[k]!), "no NaN vertex positions");
  }

  const index = mesh.geometry.getIndex();
  assert.ok(index !== null, "indexed geometry");
  assert.ok(index!.count > 0 && index!.count % 3 === 0, "whole triangles");

  // Some rays were captured, so the surface must be torn: fewer faces than a
  // fully-intact grid would have.
  let captured = 0;
  for (let i = 0; i < cone.rayCount; i += 1) {
    if (cone.rayLengths[i]! < cone.sampleCount) captured += 1;
  }
  assert.ok(captured > 0, "some rays were absorbed/escaped");
  const fullFaces = cone.rayCount + cone.rayCount * (cone.sampleCount - 2) * 2;
  assert.ok(index!.count / 3 < fullFaces, "surface is torn where rays terminated");

  mesh.dispose();
});
