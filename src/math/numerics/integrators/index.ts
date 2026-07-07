// Integration schemes as Method/Solver pairs. A Method is a reusable config;
// binding it to an initial value yields a Solver that owns one trajectory and
// advances it to a target affine parameter. Fixed-step schemes (RK4, implicit
// midpoint) and the adaptive Dormand–Prince all share the Solver protocol.
export * from "./solver.ts";
export * from "./rk4.ts";
export * from "./implicit-midpoint.ts";
export * from "./dormand-prince.ts";
