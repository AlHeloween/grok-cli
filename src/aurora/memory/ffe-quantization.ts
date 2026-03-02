/**
 * FFE (Fractal Feature Encoding) 3-9-2 quantization (reference implementation).
 * Based on Aurora‑Genesis memory/ffe_quantization.py.
 * 
 * FFE format: 3 bits for level, 9 bits for index, 2 bits for sub‑index (total 14 bits).
 */

import { generateSierpinskiCentroids } from "../fractal/sierpinski.js";

export interface FFEAddress {
  level: number;      // 0‑7 (3 bits)
  index: number;      // 0‑511 (9 bits)
  subIndex: number;   // 0‑3 (2 bits)
}

export interface QuantizationMetadata {
  exactPosition: number[];   // Original vector
  quantizationError: number;  // L2 distance to quantized position
  address: FFEAddress;        // Quantized address
}

/**
 * Encode FFE address to 14‑bit integer.
 */
export function addressToBits(addr: FFEAddress): number {
  return (addr.level << 11) | (addr.index << 2) | addr.subIndex;
}

/**
 * Decode 14‑bit integer to FFE address.
 */
export function bitsToAddress(bits: number): FFEAddress {
  const level = (bits >> 11) & 0x7;
  const index = (bits >> 2) & 0x1FF;
  const subIndex = bits & 0x3;
  return { level, index, subIndex };
}

export class FFEQuantizer {
  /** Number of hierarchical levels (max 8, 3 bits). */
  readonly nLevels: number;
  /** Number of centroids per level (max 512, 9 bits). */
  readonly nPerLevel: number;
  /** Dimension of vectors (default 8 for dual quaternions). */
  readonly dim: number;
  /** Seed for deterministic centroid generation. */
  readonly seed: number;
  
  /** Centroids[level][index][dim]. */
  private centroids: number[][][] = [];
  
  constructor(options: {
    nLevels?: number;
    nPerLevel?: number;
    dim?: number;
    seed?: number;
  }) {
    const nLevels = options.nLevels ?? 8;
    const nPerLevel = options.nPerLevel ?? 512;
    if (nLevels > 8) {
      throw new Error(`nLevels must be <= 8 (3 bits), got ${nLevels}`);
    }
    if (nPerLevel > 512) {
      throw new Error(`nPerLevel must be <= 512 (9 bits), got ${nPerLevel}`);
    }
    this.nLevels = nLevels;
    this.nPerLevel = nPerLevel;
    this.dim = options.dim ?? 8;
    this.seed = options.seed ?? 1234;
    
    this.initCentroids();
  }
  
  private initCentroids(): void {
    for (let level = 0; level < this.nLevels; level++) {
      // Depth increases with level (finer granularity at higher levels)
      const depth = level + 1;
      
      const centroids = generateSierpinskiCentroids({
        nDim: this.dim,
        depth,
        seed: this.seed + level,
        maxCentroids: this.nPerLevel,
      });
      
      // Ensure we have exactly nPerLevel centroids (pad if needed)
      const needed = this.nPerLevel - centroids.length;
      if (needed > 0) {
        const padding: number[][] = Array.from({ length: needed }, () =>
          new Array(this.dim).fill(0)
        );
        centroids.push(...padding);
      } else if (needed < 0) {
        centroids.splice(this.nPerLevel);
      }
      
      this.centroids[level] = centroids;
    }
  }
  
  /**
   * Quantize a single vector to FFE address.
   */
  quantize(
    vector: number[],
    returnMetadata: boolean = false
  ): number | [number, QuantizationMetadata] {
    if (vector.length !== this.dim) {
      throw new Error(`Vector dimension mismatch: expected ${this.dim}, got ${vector.length}`);
    }
    
    let bestLevel = 0;
    let bestIndex = 0;
    let bestSubIndex = 0;
    let bestDistance = Infinity;
    let _bestCentroid: number[] | null = null;
    
    // Search across all levels
    for (let level = 0; level < this.nLevels; level++) {
      const levelCentroids = this.centroids[level];
      
      for (let idx = 0; idx < levelCentroids.length; idx++) {
        const centroid = levelCentroids[idx];
        // Compute L2 distance
        let distSq = 0;
        for (let d = 0; d < this.dim; d++) {
          const diff = vector[d] - centroid[d];
          distSq += diff * diff;
        }
        const dist = Math.sqrt(distSq);
        
        // For sub‑index, we could subdivide the cell into 4 regions.
        // Reference implementation uses 0.
        const subIdx = 0;
        
        if (dist < bestDistance) {
          bestDistance = dist;
          bestLevel = level;
          bestIndex = idx;
          bestSubIndex = subIdx;
          _bestCentroid = centroid;
        }
      }
    }
    
    const address: FFEAddress = {
      level: bestLevel,
      index: bestIndex,
      subIndex: bestSubIndex,
    };
    const addressBits = addressToBits(address);
    
    if (!returnMetadata) {
      return addressBits;
    }
    
    const metadata: QuantizationMetadata = {
      exactPosition: vector.slice(),
      quantizationError: bestDistance,
      address,
    };
    
    return [addressBits, metadata];
  }
  
  /**
   * Quantize a batch of vectors.
   */
  quantizeBatch(
    vectors: number[][],
    returnMetadata: boolean = false
  ): number[] | [number[], QuantizationMetadata[]] {
    const addresses: number[] = [];
    const metadataList: QuantizationMetadata[] = [];
    
    for (const vec of vectors) {
      if (returnMetadata) {
        const [bits, meta] = this.quantize(vec, true) as [number, QuantizationMetadata];
        addresses.push(bits);
        metadataList.push(meta);
      } else {
        addresses.push(this.quantize(vec, false) as number);
      }
    }
    
    if (returnMetadata) {
      return [addresses, metadataList];
    }
    return addresses;
  }
  
  /**
   * Dequantize an address (or bits) back to centroid vector.
   */
  dequantize(addressOrBits: FFEAddress | number): number[] {
    const addr = typeof addressOrBits === "number"
      ? bitsToAddress(addressOrBits)
      : addressOrBits;
    
    if (addr.level >= this.nLevels) {
      throw new Error(`Level ${addr.level} out of range (max ${this.nLevels - 1})`);
    }
    if (addr.index >= this.nPerLevel) {
      throw new Error(`Index ${addr.index} out of range (max ${this.nPerLevel - 1})`);
    }
    if (addr.subIndex >= 4) {
      throw new Error(`SubIndex ${addr.subIndex} out of range (max 3)`);
    }
    
    const centroid = this.centroids[addr.level][addr.index];
    if (!centroid) {
      throw new Error(`Centroid at level ${addr.level}, index ${addr.index} not found`);
    }
    
    // Return copy
    return centroid.slice();
  }
  
  /**
   * Get all centroids for a specific level.
   */
  getCentroids(level: number): number[][] {
    if (level < 0 || level >= this.nLevels) {
      throw new Error(`Level ${level} out of range`);
    }
    return this.centroids[level].map(c => c.slice());
  }
  
  /**
   * Compute quantization error statistics for a set of vectors.
   */
  computeQuantizationError(vectors: number[][]): {
    meanError: number;
    maxError: number;
    minError: number;
  } {
    let totalError = 0;
    let maxError = 0;
    let minError = Infinity;
    
    for (const vec of vectors) {
      const [, meta] = this.quantize(vec, true) as [number, QuantizationMetadata];
      const err = meta.quantizationError;
      totalError += err;
      if (err > maxError) maxError = err;
      if (err < minError) minError = err;
    }
    
    return {
      meanError: vectors.length > 0 ? totalError / vectors.length : 0,
      maxError,
      minError,
    };
  }
}

/**
 * Simplified FFE quantization with default parameters.
 * @param vector Input vector (length 8 recommended)
 * @param nLevels Number of hierarchical levels (default: 3)
 * @param nPerLevel Number of centroids per level (default: 9)
 * @returns 14-bit address integer
 */
export function ffeQuantize(
  vector: number[],
  nLevels: number = 3,
  nPerLevel: number = 9
): number {
  const quantizer = new FFEQuantizer({ nLevels, nPerLevel, dim: vector.length });
  return quantizer.quantize(vector, false) as number;
}

/**
 * Convert FFE address bits to human-readable string.
 * Format: "L{level}.{index}.{subIndex}"
 */
export function ffeAddressToString(bits: number): string {
  const addr = bitsToAddress(bits);
  return `L${addr.level}.${addr.index}.${addr.subIndex}`;
}

/**
 * Convert FFE address object to string.
 */
export function ffeAddressToStringFromAddr(addr: FFEAddress): string {
  return `L${addr.level}.${addr.index}.${addr.subIndex}`;
}
