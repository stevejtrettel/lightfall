import type { LightCone } from "../../lightcone/index.ts";

// A 2D render adapter: the spatial (x, y) projection of a light cone as a
// standalone SVG string — the classic gravitational-lensing picture, with each
// null geodesic's track fanning from the apex and bending around the holes.
// Zero dependencies, opens in any browser or editor preview. This is the
// geometry check that comes before the 3D Three.js view; both consume the same
// LightCone grid (compute once, render many). Wavefront rings are a later
// overlay.

export interface HoleMarker {
  x: number;
  y: number;
  // Drawn radius in world units (a cosmetic throat). Default 0.15.
  radius?: number;
}

export interface ConeSvgOptions {
  width?: number; // px, default 800
  padding?: number; // px, default 24
  // Explicit world-space window; auto-fit to the rays (+ holes, apex) if omitted.
  bounds?: { xMin: number; xMax: number; yMin: number; yMax: number };
  holes?: readonly HoleMarker[];
  background?: string; // default near-black
  strokeWidth?: number; // ray stroke, px; default 1
  // Hue each ray by its emission angle (shows the fan structure). Default true.
  colorByAngle?: boolean;
  // Caustic curve as packed segments (6 floats each: t,x,y, t,x,y) — from
  // `causticSegments(cone)`. Drawn as a bright overlay.
  caustics?: Float64Array;
}

const f = (v: number): string => v.toFixed(2);

export function coneToSvg(cone: LightCone, options: ConeSvgOptions = {}): string {
  const width = options.width ?? 800;
  const pad = options.padding ?? 24;
  const bg = options.background ?? "#0a0a0f";
  const strokeWidth = options.strokeWidth ?? 1;
  const colorByAngle = options.colorByAngle ?? true;
  const holes = options.holes ?? [];

  const bounds = options.bounds ?? autoBounds(cone, holes);
  const spanX = Math.max(bounds.xMax - bounds.xMin, 1e-9);
  const spanY = Math.max(bounds.yMax - bounds.yMin, 1e-9);
  const scale = (width - 2 * pad) / spanX;
  const height = Math.ceil(spanY * scale + 2 * pad);

  // World → SVG pixels. SVG's y points down, so flip.
  const px = (x: number): number => pad + (x - bounds.xMin) * scale;
  const py = (y: number): number => height - (pad + (y - bounds.yMin) * scale);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="${bg}"/>`);

  // Ray tracks (spatial projection: forget t).
  for (let i = 0; i < cone.rayCount; i += 1) {
    const len = cone.rayLengths[i]!;
    if (len < 2) continue;
    let pts = "";
    for (let j = 0; j < len; j += 1) {
      pts += `${f(px(cone.coord(i, j, 1)))},${f(py(cone.coord(i, j, 2)))} `;
    }
    const stroke = colorByAngle
      ? `hsl(${Math.round((360 * i) / cone.rayCount)}, 80%, 62%)`
      : "#7fd0ff";
    parts.push(
      `<polyline points="${pts.trim()}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="0.85"/>`,
    );
  }

  // Caustic curve (bright overlay, on top of the rays).
  const caustics = options.caustics;
  if (caustics) {
    for (let s = 0; s < caustics.length; s += 6) {
      // packed as (t, x, y, t, x, y) — draw the spatial (x, y) projection
      parts.push(
        `<line x1="${f(px(caustics[s + 1]!))}" y1="${f(py(caustics[s + 2]!))}" ` +
          `x2="${f(px(caustics[s + 4]!))}" y2="${f(py(caustics[s + 5]!))}" ` +
          `stroke="#ffffff" stroke-width="2" stroke-opacity="0.95"/>`,
      );
    }
  }

  // Holes (filled disks with a bright rim — the horizons).
  for (const hole of holes) {
    const r = (hole.radius ?? 0.15) * scale;
    parts.push(
      `<circle cx="${f(px(hole.x))}" cy="${f(py(hole.y))}" r="${f(Math.max(r, 2))}" fill="#000" stroke="#ff7a1a" stroke-width="1.5"/>`,
    );
  }

  // Apex (the emission event).
  parts.push(`<circle cx="${f(px(cone.apexX))}" cy="${f(py(cone.apexY))}" r="4" fill="#ffffff"/>`);

  parts.push("</svg>");
  return parts.join("\n");
}

function autoBounds(
  cone: LightCone,
  holes: readonly HoleMarker[],
): { xMin: number; xMax: number; yMin: number; yMax: number } {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  const grow = (x: number, y: number): void => {
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  };

  for (let i = 0; i < cone.rayCount; i += 1) {
    const len = cone.rayLengths[i]!;
    for (let j = 0; j < len; j += 1) grow(cone.coord(i, j, 1), cone.coord(i, j, 2));
  }
  grow(cone.apexX, cone.apexY);
  for (const h of holes) {
    const r = h.radius ?? 0.15;
    grow(h.x - r, h.y - r);
    grow(h.x + r, h.y + r);
  }

  // A little breathing room.
  const mx = (xMax - xMin) * 0.05 || 1;
  const my = (yMax - yMin) * 0.05 || 1;
  return { xMin: xMin - mx, xMax: xMax + mx, yMin: yMin - my, yMax: yMax + my };
}
