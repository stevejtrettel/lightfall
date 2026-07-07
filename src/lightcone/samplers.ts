// Emission-direction samplers: the injected parameter that decides which null
// directions a light cone fans out. This is where the inspiration code's six
// forked cone files collapse into one argument — a full 360° cone, a narrow
// observer's pencil, or a bespoke distribution are all just different arrays
// of angles handed to the same `lightCone`.

// `count` angles evenly around the circle, starting at `offset` (radians).
export function uniformDirections(count: number, offset = 0): number[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`uniformDirections needs count ≥ 1, got ${count}`);
  }
  const out: number[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = offset + (2 * Math.PI * i) / count;
  }
  return out;
}

// `count` angles spanning [center − halfSpread, center + halfSpread] — a
// directed pencil of light (an observer's field of view onto the cone).
export function pencilDirections(
  center: number,
  halfSpread: number,
  count: number,
): number[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`pencilDirections needs count ≥ 1, got ${count}`);
  }
  if (count === 1) return [center];
  const out: number[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = center - halfSpread + (2 * halfSpread * i) / (count - 1);
  }
  return out;
}
