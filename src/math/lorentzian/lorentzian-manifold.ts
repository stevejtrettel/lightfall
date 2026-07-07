import type { Space, SpaceView } from "../spaces/index.ts";
import type { Metric } from "./metric.ts";

// A spacetime: a coordinate chart together with a Lorentzian metric on it.
// This is all the general engine assumes (plan §3.1) — geodesic flow, the
// null cone, and everything downstream are derived from `(chart, metric)`
// alone. Concrete spacetimes (Minkowski, Majumdar–Papapetrou, …) are just
// particular metrics on a chart.
export class LorentzianManifold<V extends SpaceView> {
  readonly chart: Space<V>;
  readonly metric: Metric;

  constructor(chart: Space<V>, metric: Metric) {
    if (chart.dimension !== metric.dimension) {
      throw new RangeError(
        `chart dimension ${chart.dimension} ≠ metric dimension ${metric.dimension}`,
      );
    }
    this.chart = chart;
    this.metric = metric;
  }

  get dimension(): number {
    return this.chart.dimension;
  }

  get timeIndex(): number {
    return this.metric.timeIndex;
  }
}
