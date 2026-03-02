/**
 * Dual quaternion operations for Aurora reference implementation.
 * 
 * Dual quaternion representation: q = q_r + ε q_d
 * where q_r is rotation quaternion (4D), q_d is translation quaternion (4D).
 * Total: 8 dimensions per dual quaternion.
 * 
 * This is a lightweight TypeScript reference implementation of the Aurora Genesis
 * dual quaternion module, not intended for production use.
 */

/**
 * Dual quaternion as Float32Array of length 8: [wr, xr, yr, zr, wd, xd, yd, zd]
 */
export type DualQuaternion = Float32Array;

/**
 * Conjugate of quaternion: (w, x, y, z) -> (w, -x, -y, -z)
 */
export function quatConjugate(q: Float32Array): Float32Array {
  const result = new Float32Array(4);
  result[0] = q[0]; // w
  result[1] = -q[1]; // -x
  result[2] = -q[2]; // -y
  result[3] = -q[3]; // -z
  return result;
}

/**
 * Multiply two quaternions: q1 * q2.
 * 
 * Formula:
 * q1 = (w1, x1, y1, z1)
 * q2 = (w2, x2, y2, z2)
 * q1 * q2 = (
 *   w1*w2 - x1*x2 - y1*y2 - z1*z2,
 *   w1*x2 + x1*w2 + y1*z2 - z1*y2,
 *   w1*y2 - x1*z2 + y1*w2 + z1*x2,
 *   w1*z2 + x1*y2 - y1*x2 + z1*w2
 * )
 */
export function quatMultiply(q1: Float32Array, q2: Float32Array): Float32Array {
  const w1 = q1[0], x1 = q1[1], y1 = q1[2], z1 = q1[3];
  const w2 = q2[0], x2 = q2[1], y2 = q2[2], z2 = q2[3];

  const w = w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2;
  const x = w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2;
  const y = w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2;
  const z = w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2;

  const result = new Float32Array(4);
  result[0] = w;
  result[1] = x;
  result[2] = y;
  result[3] = z;
  return result;
}

/**
 * Extract translation vector from dual quaternion.
 * 
 * Formula: t = 2 * (dual * conjugate(real)).vector_part
 * Returns Float32Array of length 3.
 */
export function extractTranslationDualQuat(dq: DualQuaternion): Float32Array {
  // Split into real and dual quaternions
  const real = dq.subarray(0, 4); // (4)
  const dual = dq.subarray(4, 8); // (4)

  // Normalize real part
  const realNorm = Math.sqrt(real[0]**2 + real[1]**2 + real[2]**2 + real[3]**2);
  const eps = 1e-8;
  const realNormalized = new Float32Array(4);
  realNormalized[0] = real[0] / (realNorm + eps);
  realNormalized[1] = real[1] / (realNorm + eps);
  realNormalized[2] = real[2] / (realNorm + eps);
  realNormalized[3] = real[3] / (realNorm + eps);

  // Compute: dual * conjugate(real)
  const realConj = quatConjugate(realNormalized);
  const prod = quatMultiply(dual, realConj);

  // Extract vector part (x, y, z) and multiply by 2
  const translation = new Float32Array(3);
  translation[0] = 2.0 * prod[1]; // x
  translation[1] = 2.0 * prod[2]; // y
  translation[2] = 2.0 * prod[3]; // z
  return translation;
}

/**
 * Compute geodesic distance between two dual quaternions on SE(3) manifold.
 * 
 * Formula:
 * - Rotation distance: geodesic on SO(3) = ||log(R1^T R2)|| = 2 * |arccos(<R1, R2>)|.
 * - Translation distance: Euclidean ||t1 - t2||.
 * - Combined: w_rot * rot_dist + w_trans * trans_dist.
 * 
 * @param dq1 Dual quaternion (length 8)
 * @param dq2 Dual quaternion (length 8)
 * @param wRot Weight for rotational distance component (default: 1.0)
 * @param wTrans Weight for translational distance component (default: 1.0)
 * @returns Geodesic distance (scalar)
 */
export function dualQuatGeodesicDistance(
  dq1: DualQuaternion,
  dq2: DualQuaternion,
  wRot: number = 1.0,
  wTrans: number = 1.0
): number {
  if (dq1.length !== 8) throw new Error(`Dual quaternions must have length=8, got ${dq1.length}`);
  if (dq2.length !== 8) throw new Error(`Dual quaternions must have length=8, got ${dq2.length}`);

  // Normalize real parts (rotation quaternions)
  const real1 = dq1.subarray(0, 4);
  const real2 = dq2.subarray(0, 4);

  const norm1 = Math.sqrt(real1[0]**2 + real1[1]**2 + real1[2]**2 + real1[3]**2);
  const norm2 = Math.sqrt(real2[0]**2 + real2[1]**2 + real2[2]**2 + real2[3]**2);
  const eps = 1e-8;

  const r1 = new Float32Array(4);
  const r2 = new Float32Array(4);
  r1[0] = real1[0] / (norm1 + eps);
  r1[1] = real1[1] / (norm1 + eps);
  r1[2] = real1[2] / (norm1 + eps);
  r1[3] = real1[3] / (norm1 + eps);
  r2[0] = real2[0] / (norm2 + eps);
  r2[1] = real2[1] / (norm2 + eps);
  r2[2] = real2[2] / (norm2 + eps);
  r2[3] = real2[3] / (norm2 + eps);

  // Rotation distance: geodesic on SO(3)
  // Compute R1^T * R2 = conjugate(R1) * R2
  const r1Conj = quatConjugate(r1);
  const rotDiff = quatMultiply(r1Conj, r2);

  // Angle = 2 * arccos(dot(R1, R2)) = 2 * arccos(rotDiff[0])
  // Clamp dot product to [-1, 1] for numerical stability
  let dotProduct = rotDiff[0];
  if (dotProduct > 1.0) dotProduct = 1.0;
  if (dotProduct < -1.0) dotProduct = -1.0;
  const rotAngle = 2.0 * Math.acos(Math.abs(dotProduct)); // Use abs to handle double cover
  const rotDist = rotAngle;

  // Translation distance: Euclidean
  const trans1 = extractTranslationDualQuat(dq1);
  const trans2 = extractTranslationDualQuat(dq2);
  const dx = trans1[0] - trans2[0];
  const dy = trans1[1] - trans2[1];
  const dz = trans1[2] - trans2[2];
  const transDist = Math.sqrt(dx*dx + dy*dy + dz*dz);

  // Weighted combination
  return wRot * rotDist + wTrans * transDist;
}

/**
 * Batched geodesic distance computation for arrays of dual quaternions.
 * Returns a distance matrix (n x n) as number[][].
 */
export function dualQuatGeodesicDistanceMatrix(
  dualQuats: DualQuaternion[],
  wRot: number = 1.0,
  wTrans: number = 1.0
): number[][] {
  const n = dualQuats.length;
  const D: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = dualQuatGeodesicDistance(dualQuats[i], dualQuats[j], wRot, wTrans);
      D[i][j] = d;
      D[j][i] = d;
    }
  }
  return D;
}

/**
 * Convert a regular vector (Float32Array) to a dual quaternion representation.
 * This is a simple reference mapping: first 4 components become rotation quaternion,
 * next 4 become translation quaternion. If vector length < 8, pad with zeros.
 */
export function vectorToDualQuaternion(vec: Float32Array): DualQuaternion {
  const result = new Float32Array(8);
  const len = Math.min(vec.length, 8);
  for (let i = 0; i < len; i++) {
    result[i] = vec[i];
  }
  // Ensure rotation quaternion is non-zero (add small epsilon to w component)
  if (result[0] === 0 && result[1] === 0 && result[2] === 0 && result[3] === 0) {
    result[0] = 1e-6;
  }
  return result;
}