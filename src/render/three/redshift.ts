import { Color, SRGBColorSpace } from "three";

// Redshift colouring for the *backward* light cone. Each null geodesic starts at
// its integration edge (its source) with a fixed frequency; travelling backward
// toward the apex it accumulates gravitational shift. In a static spacetime a
// static observer measures frequency f = E·U (E the conserved photon energy, U
// the potential), so the accumulated shift at a point is exactly the ratio of
// the endpoint potentials — path-independent, no per-step integration:
//
//     ratio = f(x)/f(source) = U(x)/U(source) = rf(x)/rf(source)
//
// ratio < 1 ⇒ net redshift (climbed out of the well); ratio > 1 ⇒ net blueshift
// (fell deeper). We map that onto a diverging warm/cool ramp centred on yellow:
// yellow at zero shift, saturated reds toward redshift, blues toward blueshift —
// routed through high luminance so it never passes through green, and never
// muddies to brown. (The ratio itself is formed by the caller; this module is
// purely the value → colour map.)

export type RedshiftAnchor = "edge" | "depth" | "infinity";

export interface RedshiftOptions {
  // ln-ratio that reaches full saturation. Bigger ⇒ more of the frame stays
  // yellow (a gentler map). Default 1.5.
  scale?: number;
  // Multiplies the normalised shift before the ramp. Default 1.
  exaggeration?: number;
  // How the shift ratio is formed (by the mesh builder, not by shiftColor):
  //   "edge"     — accumulated along each ray from its own integration endpoint
  //                (history-dependent: infalling light blue, climbing-out light
  //                red, with a real seam at the shadow edge).
  //   "depth"    — gravitational shift by depth alone, relative to the observer's
  //                potential (continuous: deep→red, observer depth→yellow,
  //                far→blue; no history, so no seam).
  //   "infinity" — as if the light came in from spatial infinity (U→1, the
  //                far-field sky): ratio = U(x), so the picture is a pure
  //                depth-blueshift map, yellow at infinity deepening to blue
  //                toward every well. Rays that are *absorbed* did not come from
  //                infinity — they originate at the throat — so those keep their
  //                true near-horizon source and read deep red (the shadow).
  anchor?: RedshiftAnchor;
}

const DEFAULT_SCALE = 1.5;

interface Stop {
  p: number;
  c: [number, number, number];
}

// Redshift side (|q|, from yellow): yellow → orange → red → deep red.
const RED_STOPS: Stop[] = [
  { p: 0.0, c: [1.0, 0.82, 0.15] },
  { p: 0.45, c: [1.0, 0.48, 0.08] },
  { p: 0.8, c: [0.92, 0.16, 0.06] },
  { p: 1.0, c: [0.68, 0.05, 0.06] },
];

// Blueshift side (q, from yellow): yellow → warm pale → periwinkle → blue. The
// pale high-luminance step is what keeps the path clear of green.
const BLUE_STOPS: Stop[] = [
  { p: 0.0, c: [1.0, 0.82, 0.15] },
  { p: 0.4, c: [0.98, 0.9, 0.62] },
  { p: 0.72, c: [0.52, 0.62, 1.0] },
  { p: 1.0, c: [0.13, 0.3, 0.93] },
];

function ramp(stops: Stop[], m: number): [number, number, number] {
  if (m <= stops[0]!.p) return stops[0]!.c;
  const last = stops[stops.length - 1]!;
  if (m >= last.p) return last.c;
  for (let i = 1; i < stops.length; i += 1) {
    const b = stops[i]!;
    if (m <= b.p) {
      const a = stops[i - 1]!;
      const f = (m - a.p) / (b.p - a.p);
      return [
        a.c[0] + f * (b.c[0] - a.c[0]),
        a.c[1] + f * (b.c[1] - a.c[1]),
        a.c[2] + f * (b.c[2] - a.c[2]),
      ];
    }
  }
  return last.c;
}

// Write the diverging-ramp colour for a frequency `ratio` into `target`. The
// sRGB stops are handed to three's colour management so the stored linear values
// match the rest of the scene.
export function shiftColor(
  target: Color,
  ratio: number,
  options: RedshiftOptions = {},
): Color {
  const scale = options.scale ?? DEFAULT_SCALE;
  const k = options.exaggeration ?? 1;
  const t = Math.log(ratio > 0 ? ratio : 1e-6); // >0 blueshift, <0 redshift
  const q = Math.min(Math.max((t / scale) * k, -1), 1);
  const [r, g, b] = q >= 0 ? ramp(BLUE_STOPS, q) : ramp(RED_STOPS, -q);
  return target.setRGB(r, g, b, SRGBColorSpace);
}
