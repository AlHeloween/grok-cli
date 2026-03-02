/**
 * Sierpinski lattice addressing (reference implementation).
 * Based on Aurora‑Genesis memory/lattice_addressing.py.
 * 
 * Provides hierarchical address space using Sierpinski lattice structure.
 */

import { FFEAddress, addressToBits, bitsToAddress } from "./ffe-quantization.js";

export interface SierpinskiLatticeAddress {
  level: number;      // 0‑7 (3 bits)
  index: number;      // 0‑511 (9 bits)
  subIndex: number;   // 0‑3 (2 bits)
}

/**
 * Convert lattice address to FFE address.
 */
export function latticeToFFE(latticeAddr: SierpinskiLatticeAddress): FFEAddress {
  return {
    level: latticeAddr.level,
    index: latticeAddr.index,
    subIndex: latticeAddr.subIndex,
  };
}

/**
 * Convert FFE address to lattice address.
 */
export function ffeToLattice(ffeAddr: FFEAddress): SierpinskiLatticeAddress {
  return {
    level: ffeAddr.level,
    index: ffeAddr.index,
    subIndex: ffeAddr.subIndex,
  };
}

/**
 * Encode lattice address to 14‑bit integer.
 */
export function latticeAddressToBits(addr: SierpinskiLatticeAddress): number {
  return addressToBits(latticeToFFE(addr));
}

/**
 * Decode 14‑bit integer to lattice address.
 */
export function bitsToLatticeAddress(bits: number): SierpinskiLatticeAddress {
  return ffeToLattice(bitsToAddress(bits));
}

// Helper functions for navigation

export function getParentAddress(addr: SierpinskiLatticeAddress): SierpinskiLatticeAddress | null {
  if (addr.level === 0) return null;
  return {
    level: addr.level - 1,
    index: Math.floor(addr.index / 2),
    subIndex: Math.floor(addr.subIndex / 2),
  };
}

export function getChildAddresses(addr: SierpinskiLatticeAddress, maxLevel: number): SierpinskiLatticeAddress[] {
  if (addr.level >= maxLevel) return [];
  const children: SierpinskiLatticeAddress[] = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      children.push({
        level: addr.level + 1,
        index: addr.index * 2 + i,
        subIndex: addr.subIndex * 2 + j,
      });
    }
  }
  return children;
}

export function getSiblingAddresses(addr: SierpinskiLatticeAddress): SierpinskiLatticeAddress[] {
  const siblings: SierpinskiLatticeAddress[] = [];
  // Simple implementation: return addresses with same level, index, but different subIndex
  for (let sub = 0; sub < 4; sub++) {
    if (sub === addr.subIndex) continue;
    siblings.push({ ...addr, subIndex: sub });
  }
  return siblings;
}

export class LatticeAddressing {
  readonly nLevels: number;
  readonly nPerLevel: number;
  readonly dim: number;
  readonly seed: number;
  
  constructor(options: {
    nLevels?: number;
    nPerLevel?: number;
    dim?: number;
    seed?: number;
  }) {
    this.nLevels = options.nLevels ?? 8;
    this.nPerLevel = options.nPerLevel ?? 512;
    this.dim = options.dim ?? 8;
    this.seed = options.seed ?? 1234;
  }
  
  /**
   * Generate all possible addresses (for a given level or all levels).
   */
  generateAddresses(level?: number): SierpinskiLatticeAddress[] {
    const addresses: SierpinskiLatticeAddress[] = [];
    
    const startLevel = level ?? 0;
    const endLevel = level ?? this.nLevels - 1;
    
    for (let lvl = startLevel; lvl <= endLevel; lvl++) {
      const indices = Math.min(this.nPerLevel, 512); // Max 9 bits
      for (let idx = 0; idx < indices; idx++) {
        for (let sub = 0; sub < 4; sub++) {
          addresses.push({ level: lvl, index: idx, subIndex: sub });
        }
      }
    }
    
    return addresses;
  }
  
  /**
   * Convert a continuous vector to the nearest lattice address (using FFE quantization).
   * Requires an external quantizer.
   */
  vectorToAddress(
    vector: number[],
    quantizer: any // eslint-disable-line @typescript-eslint/no-explicit-any
  ): SierpinskiLatticeAddress {
    const bits = quantizer.quantize(vector, false) as number;
    return bitsToLatticeAddress(bits);
  }
  
  /**
   * Convert address back to centroid vector (using quantizer).
   */
  addressToVector(
    addr: SierpinskiLatticeAddress,
    quantizer: any // eslint-disable-line @typescript-eslint/no-explicit-any
  ): number[] {
    const ffeAddr = latticeToFFE(addr);
    return quantizer.dequantize(ffeAddr);
  }
  
  /**
   * Build adjacency list for navigation in the lattice.
   */
  buildAdjacencyList(): Map<string, SierpinskiLatticeAddress[]> {
    const adjacency = new Map<string, SierpinskiLatticeAddress[]>();
    const addresses = this.generateAddresses();
    
    for (const addr of addresses) {
      const key = `${addr.level}:${addr.index}:${addr.subIndex}`;
      const neighbors: SierpinskiLatticeAddress[] = [];
      
      // Parent
      const parent = getParentAddress(addr);
      if (parent) neighbors.push(parent);
      
      // Children
      const children = getChildAddresses(addr, this.nLevels - 1);
      neighbors.push(...children);
      
      // Siblings
      const siblings = getSiblingAddresses(addr);
      neighbors.push(...siblings);
      
      adjacency.set(key, neighbors);
    }
    
    return adjacency;
  }
}

/**
 * Convert FFE bits to lattice address with default parameters.
 */
export function latticeAddressFromFfe(
  ffeBits: number,
  nLevels: number = 3,
  nPerLevel: number = 9
): SierpinskiLatticeAddress {
  const _addressing = new LatticeAddressing({ nLevels, nPerLevel });
  // Use existing conversion functions
  const ffeAddr = bitsToAddress(ffeBits);
  return ffeToLattice(ffeAddr);
}

/**
 * Convert lattice address to human-readable string.
 * Format: "L{level}.{index}.{subIndex}"
 */
export function latticeAddressToString(addr: SierpinskiLatticeAddress): string {
  return `L${addr.level}.${addr.index}.${addr.subIndex}`;
}
