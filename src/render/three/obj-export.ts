import { Vector3, type BufferGeometry, type Mesh, type Object3D } from "three";

// A named piece of the exported model. Every Mesh in each object's subtree
// contributes its triangles to one `o <name>` object in the OBJ.
export interface OBJGroup {
  name: string;
  objects: readonly Object3D[];
}

// Serialise a set of three.js objects to Wavefront OBJ text, one `o <name>`
// object per group. Each mesh's world transform is baked into its vertex
// positions, so grouping/placement in the scene carries through. Only positions
// and triangle faces are written — no normals or UVs — because the target is a
// solid-modelling import (Blender recomputes normals on the way to a printable
// STL, and welds the coincident trim-boundary vertices with Merge by Distance).
export function exportOBJ(groups: readonly OBJGroup[]): string {
  const lines: string[] = ["# lightfall OBJ export"];
  const p = new Vector3();
  let vertexBase = 0; // running 0-based vertex count; OBJ face indices are +1.

  for (const group of groups) {
    lines.push(`o ${group.name}`);
    for (const root of group.objects) {
      root.updateWorldMatrix(true, true);
      root.traverse((obj) => {
        const mesh = obj as Mesh;
        if (!mesh.isMesh) return;
        vertexBase = appendMesh(lines, mesh.geometry as BufferGeometry, mesh, p, vertexBase);
      });
    }
  }
  return `${lines.join("\n")}\n`;
}

function appendMesh(
  lines: string[],
  geometry: BufferGeometry,
  mesh: Mesh,
  p: Vector3,
  vertexBase: number,
): number {
  const pos = geometry.getAttribute("position");
  if (!pos) return vertexBase;

  const m = mesh.matrixWorld;
  for (let i = 0; i < pos.count; i += 1) {
    p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
    lines.push(`v ${fmt(p.x)} ${fmt(p.y)} ${fmt(p.z)}`);
  }

  const index = geometry.getIndex();
  const f = (v: number): number => vertexBase + v + 1; // OBJ is 1-based
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      lines.push(`f ${f(index.getX(i))} ${f(index.getX(i + 1))} ${f(index.getX(i + 2))}`);
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      lines.push(`f ${f(i)} ${f(i + 1)} ${f(i + 2)}`);
    }
  }
  return vertexBase + pos.count;
}

// Compact fixed-point: enough precision for a print, no exponent notation.
function fmt(x: number): string {
  return x.toFixed(6);
}

// Trigger a browser download of `text` as `filename`.
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
