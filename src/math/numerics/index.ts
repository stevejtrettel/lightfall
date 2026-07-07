// Non-trivial numerical schemes — the ones with competing choices a user
// selects between (RK4 vs. implicit midpoint, and future roots / quadrature /
// finite-difference families). Each family is a subfolder; consumers import
// from this barrel.
export * from "./integrators/index.ts";
