/**
 * i2s (2‑bit signed) quantization and dot‑product kernels.
 * Reference: llama.orig/evaluation/bitnet_purepy/i2s.py
 */

/**
 * Quantize float32 activations to int8 symmetric (matching ggml quantize_row_i8_s).
 * @param x Float32Array of length k
 * @returns { q: Int8Array, s: scale factor (float32), actSum: sum of q (int32) }
 */
export function quantizeI8S(x: Float32Array): { q: Int8Array; s: number; actSum: number } {
  // max = max(1e-5, max_i |x[i]|) scanned in double
  let amax = 0.0;
  for (let i = 0; i < x.length; ++i) {
    const abs = Math.abs(x[i]);
    if (abs > amax) amax = abs;
  }
  const maxv = amax > 1.0e-5 ? amax : 1.0e-5;
  const s = 127.0 / maxv;

  const q = new Int8Array(x.length);
  let actSum = 0;
  for (let i = 0; i < x.length; ++i) {
    let val = Math.round(x[i] * s);
    if (val < -128) val = -128;
    if (val > 127) val = 127;
    q[i] = val;
    actSum += val;
  }
  return { q, s, actSum };
}

/**
 * Dot product between a packed i2_s row (byte array) and an int8 quantized vector.
 * @param packedRow Uint8Array of length k//4 (each byte packs four 2‑bit values)
 * @param q Int8Array of length k
 * @param k dimension (must be divisible by 128)
 * @returns raw integer dot product (sum of w_i * q_i)
 */
export function dotI2SI8(packedRow: Uint8Array, q: Int8Array, k: number): number {
  const nb = k / 128; // number of 128‑value blocks
  let acc = 0;
  let idx = 0;
  for (let g = 0; g < nb; ++g) {
    const base = g * 128;
    for (let j = 0; j < 32; ++j) {
      const b = packedRow[idx++];
      const c0 = (b >> 6) & 3;
      const c1 = (b >> 4) & 3;
      const c2 = (b >> 2) & 3;
      const c3 = b & 3;
      acc += c0 * q[base + j];
      acc += c1 * q[base + 32 + j];
      acc += c2 * q[base + 64 + j];
      acc += c3 * q[base + 96 + j];
    }
  }
  return acc;
}

/**
 * Decode i2_s packed weights into dense uint8 matrix W of shape (m, k), values in {0,1,2,3}.
 * Mapping matches dotI2SI8().
 * @param packed bytes (length >= (k * m) / 4)
 * @param k inner dimension (must be divisible by 128)
 * @param m outer dimension
 * @returns Uint8Array of length m*k in row‑major order (row = m, col = k)
 */
export function decodeI2SPackedU8(packed: Uint8Array, k: number, m: number): Uint8Array {
  if (k % 128 !== 0) throw new Error("k must be divisible by 128 for i2s decode");
  const rowSize = k / 4;
  const dataBytes = (k * m) / 4;
  if (packed.length < dataBytes) throw new Error("packed buffer too small");

  const nb = k / 128;
  const w = new Uint8Array(m * k);
  const buf = new Uint8Array(packed.buffer, packed.byteOffset, rowSize * m);
  // reshape manually: for each row i, decode block
  for (let i = 0; i < m; ++i) {
    const rowOff = i * rowSize;
    for (let g = 0; g < nb; ++g) {
      const base = g * 128;
      const blockOff = rowOff + g * 32;
      for (let j = 0; j < 32; ++j) {
        const b = buf[blockOff + j];
        w[i * k + base + j] = (b >> 6) & 3;
        w[i * k + base + 32 + j] = (b >> 4) & 3;
        w[i * k + base + 64 + j] = (b >> 2) & 3;
        w[i * k + base + 96 + j] = b & 3;
      }
    }
  }
  return w;
}

/**
 * Exact i2_s weight representation as a dense float32 matrix.
 * Decodes 2‑bit weights once, then does fast GEMV per activation.
 * Memory: (k * m) float32 values (4 bytes each).
 */
export class I2SDenseWeight {
  readonly k: number;
  readonly m: number;
  readonly wScale: number;
  /** (w - 1) as float32, shape (m, k) row‑major */
  private wShiftF32: Float32Array;

  constructor(packed: Uint8Array, k: number, m: number, wScale: number) {
    this.k = k;
    this.m = m;
    this.wScale = wScale;
    const wU8 = decodeI2SPackedU8(packed, k, m);
    // Convert to float32 and subtract 1.0
    this.wShiftF32 = new Float32Array(wU8.length);
    for (let i = 0; i < wU8.length; ++i) {
      this.wShiftF32[i] = wU8[i] - 1.0;
    }
  }

  /**
   * Multiply by a vector x (length k) and return vector y (length m).
   */
  mulVec(x: Float32Array): Float32Array {
    if (x.length !== this.k) throw new Error("x shape mismatch");
    const { q, s, actSum } = quantizeI8S(x);
    const qF32 = new Float32Array(q.length);
    for (let i = 0; i < q.length; ++i) qF32[i] = q[i];

    // raw_minus = wShiftF32 @ qF32 (matrix‑vector)
    const rawMinus = new Float32Array(this.m);
    for (let i = 0; i < this.m; ++i) {
      let sum = 0.0;
      const rowOff = i * this.k;
      for (let j = 0; j < this.k; ++j) {
        sum += this.wShiftF32[rowOff + j] * qF32[j];
      }
      rawMinus[i] = sum;
    }

    const actScaleF = s;
    const wScaleF = this.wScale;
    const y = new Float32Array(this.m);
    for (let i = 0; i < this.m; ++i) {
      y[i] = (rawMinus[i] / actScaleF) * wScaleF;
    }
    return y;
  }

  /**
   * Multiply by a matrix x (shape k × nCols).
   */
  mulMat(x: Float32Array, nCols: number): Float32Array {
    if (x.length !== this.k * nCols) throw new Error("x shape mismatch");
    const out = new Float32Array(this.m * nCols);
    for (let col = 0; col < nCols; ++col) {
      const xCol = x.subarray(col * this.k, (col + 1) * this.k);
      const yCol = this.mulVec(xCol);
      out.set(yCol, col * this.m);
    }
    return out;
  }
}

/**
 * Direct i2_s matrix multiplication using packed weights and per‑column quantization.
 * Slower but memory‑efficient (no dense decode).
 */
export function i2sMulMat(
  packed: Uint8Array,
  k: number,
  m: number,
  wScale: number,
  x: Float32Array,
  nCols: number
): Float32Array {
  if (x.length !== k * nCols) throw new Error("x shape mismatch");
  const rowSize = k / 4;
  const dataBytes = (k * m) / 4;
  if (packed.length < dataBytes) throw new Error("packed buffer too small");

  const out = new Float32Array(m * nCols);
  const wScaleF = wScale;
  for (let col = 0; col < nCols; ++col) {
    const xCol = x.subarray(col * k, (col + 1) * k);
    const { q, s, actSum } = quantizeI8S(xCol);
    const actScaleF = s;
    for (let i = 0; i < m; ++i) {
      const rowOff = i * rowSize;
      const raw = dotI2SI8(
        new Uint8Array(packed.buffer, packed.byteOffset + rowOff, rowSize),
        q,
        k
      );
      out[i * nCols + col] = ((raw - actSum) / actScaleF) * wScaleF;
    }
  }
  return out;
}
