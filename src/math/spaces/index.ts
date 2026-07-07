// Packed-buffer layouts and the typed views onto them — the foundation every
// other math module reads through. No arithmetic structure lives here (see
// linalg/ for that); a Space only says where the numbers are.
export * from "./space.ts";
export * from "./vec.ts";
export * from "./product.ts";
export * from "./bundles.ts";
export * from "./buffer-ops.ts";
