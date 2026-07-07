// Maps between spaces. VectorField (the ODE right-hand side the integrators
// consume) and ScalarField (the Hamiltonian H, the potential U) are here.
// Curve and Surface arrive in Phase 4 (the light-cone rays and swept surface).
export * from "./vector-field.ts";
export * from "./scalar-field.ts";
