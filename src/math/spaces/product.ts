import { Space } from "./space.ts";
import type { NumericBuffer, SpaceView } from "./space.ts";

// A view onto a product space: the flat buffer window (from SpaceView) plus
// one typed sub-view per named part, each aliasing the same buffer at its
// part's offset. The parts are live — writing `state.pos.x` writes the
// product's backing buffer, and an integrator mutating the flat buffer is
// seen through the parts. This is the ergonomic payoff of §2.2: authoring in
// named parts, execution on one packed array.
export type ProductView<Parts extends Record<string, Space>> = SpaceView & {
  readonly [K in keyof Parts]: Parts[K] extends Space<infer V> ? V : never;
};

// Build a product of named component spaces, laid out contiguously in key
// order. Parts may repeat a space (a cotangent bundle is `{ pos: M, mom: M }`)
// or mix spaces of different dimensions.
export function productSpace<Parts extends Record<string, Space>>(
  parts: Parts,
  options: { name?: string } = {},
): Space<ProductView<Parts>> {
  const keys = Object.keys(parts) as (keyof Parts & string)[];

  const offsets: Record<string, number> = {};
  let dimension = 0;
  for (const key of keys) {
    offsets[key] = dimension;
    dimension += parts[key]!.dimension;
  }

  const name =
    options.name ??
    `(${keys.map((k) => `${k}: ${parts[k]!.name}`).join(" × ")})`;

  const viewFactory = (
    buffer: NumericBuffer,
    offset: number,
  ): ProductView<Parts> => {
    const view: Record<string, unknown> = { buffer, offset, dimension };
    for (const key of keys) {
      view[key] = parts[key]!.view(buffer, offset + offsets[key]!);
    }
    return view as unknown as ProductView<Parts>;
  };

  return new Space<ProductView<Parts>>({ name, dimension, viewFactory });
}
