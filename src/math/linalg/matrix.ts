// A small dense matrix, row-major over a Float64Array. Its job in the engine
// is to hold metric components g^{μν}(x) (and their coordinate derivatives) so
// the Hamiltonian flow can contract them with momenta. The dimensions here are
// tiny (n = 3 in 2+1), so dense storage is the right call — no sparsity, no
// ceremony.
//
// LU decomposition (for the cold-path metric inverse of a covariantly-
// specified metric, and index lowering) lands here when its first consumer
// arrives; the Hamiltonian flow never inverts, it consumes g^{μν} directly.
export class Matrix {
  readonly rows: number;
  readonly cols: number;
  readonly data: Float64Array;

  constructor(rows: number, cols: number, data?: Float64Array) {
    if (!Number.isInteger(rows) || rows <= 0 || !Number.isInteger(cols) || cols <= 0) {
      throw new RangeError(`Matrix needs positive integer dimensions, got ${rows}×${cols}`);
    }
    this.rows = rows;
    this.cols = cols;
    this.data = data ?? new Float64Array(rows * cols);
    if (this.data.length !== rows * cols) {
      throw new RangeError(
        `Matrix ${rows}×${cols} needs ${rows * cols} entries, got ${this.data.length}`,
      );
    }
  }

  static square(n: number): Matrix {
    return new Matrix(n, n);
  }

  get(i: number, j: number): number {
    return this.data[i * this.cols + j]!;
  }

  set(i: number, j: number, value: number): this {
    this.data[i * this.cols + j] = value;
    return this;
  }

  zero(): this {
    this.data.fill(0);
    return this;
  }
}
