import { describe, it, expect } from 'vitest';
import {
  SierpinskiLatticeAddress,
  latticeToFFE,
  ffeToLattice,
  latticeAddressToBits,
  bitsToLatticeAddress,
  getParentAddress,
  getChildAddresses,
  getSiblingAddresses,
  LatticeAddressing,
  latticeAddressFromFfe,
  latticeAddressToString,
} from './lattice-addressing.js';

describe('lattice-addressing', () => {
  describe('latticeToFFE / ffeToLattice', () => {
    it('round-trip conversion', () => {
      const latticeAddr: SierpinskiLatticeAddress = { level: 3, index: 127, subIndex: 2 };
      const ffeAddr = latticeToFFE(latticeAddr);
      expect(ffeAddr).toEqual({ level: 3, index: 127, subIndex: 2 });
      const back = ffeToLattice(ffeAddr);
      expect(back).toEqual(latticeAddr);
    });
  });

  describe('latticeAddressToBits / bitsToLatticeAddress', () => {
    it('converts lattice address to bits and back', () => {
      const addr: SierpinskiLatticeAddress = { level: 5, index: 255, subIndex: 1 };
      const bits = latticeAddressToBits(addr);
      expect(bits).toBeGreaterThanOrEqual(0);
      expect(bits).toBeLessThan(2 ** 14);
      const decoded = bitsToLatticeAddress(bits);
      expect(decoded).toEqual(addr);
    });

    it('handles max values', () => {
      const addr: SierpinskiLatticeAddress = { level: 7, index: 511, subIndex: 3 };
      const bits = latticeAddressToBits(addr);
      expect(bits).toBe((7 << 11) | (511 << 2) | 3);
      const decoded = bitsToLatticeAddress(bits);
      expect(decoded).toEqual(addr);
    });
  });

  describe('getParentAddress', () => {
    it('returns null for level 0', () => {
      const addr: SierpinskiLatticeAddress = { level: 0, index: 10, subIndex: 1 };
      expect(getParentAddress(addr)).toBeNull();
    });

    it('computes parent address', () => {
      const addr: SierpinskiLatticeAddress = { level: 3, index: 17, subIndex: 2 };
      const parent = getParentAddress(addr);
      expect(parent).toEqual({ level: 2, index: 8, subIndex: 1 });
    });
  });

  describe('getChildAddresses', () => {
    it('returns empty array when level >= maxLevel', () => {
      const addr: SierpinskiLatticeAddress = { level: 5, index: 0, subIndex: 0 };
      const children = getChildAddresses(addr, 5);
      expect(children).toEqual([]);
    });

    it('computes four child addresses', () => {
      const addr: SierpinskiLatticeAddress = { level: 2, index: 3, subIndex: 1 };
      const children = getChildAddresses(addr, 8);
      expect(children).toHaveLength(4);
      expect(children).toContainEqual({ level: 3, index: 6, subIndex: 2 });
      expect(children).toContainEqual({ level: 3, index: 6, subIndex: 3 });
      expect(children).toContainEqual({ level: 3, index: 7, subIndex: 2 });
      expect(children).toContainEqual({ level: 3, index: 7, subIndex: 3 });
    });
  });

  describe('getSiblingAddresses', () => {
    it('returns three sibling addresses', () => {
      const addr: SierpinskiLatticeAddress = { level: 1, index: 5, subIndex: 2 };
      const siblings = getSiblingAddresses(addr);
      expect(siblings).toHaveLength(3);
      const subIndices = siblings.map(s => s.subIndex).sort();
      expect(subIndices).toEqual([0, 1, 3]);
      siblings.forEach(sibling => {
        expect(sibling.level).toBe(1);
        expect(sibling.index).toBe(5);
      });
    });
  });

  describe('LatticeAddressing class', () => {
    it('initializes with defaults', () => {
      const addressing = new LatticeAddressing({});
      expect(addressing.nLevels).toBe(8);
      expect(addressing.nPerLevel).toBe(512);
      expect(addressing.dim).toBe(8);
      expect(addressing.seed).toBe(1234);
    });

    it('respects custom options', () => {
      const addressing = new LatticeAddressing({
        nLevels: 3,
        nPerLevel: 9,
        dim: 4,
        seed: 42,
      });
      expect(addressing.nLevels).toBe(3);
      expect(addressing.nPerLevel).toBe(9);
      expect(addressing.dim).toBe(4);
      expect(addressing.seed).toBe(42);
    });

    it('generates addresses for a specific level', () => {
      const addressing = new LatticeAddressing({ nLevels: 3, nPerLevel: 4 });
      const addresses = addressing.generateAddresses(1);
      expect(addresses.length).toBe(4 * 4); // 4 indices * 4 subIndices
      addresses.forEach(addr => {
        expect(addr.level).toBe(1);
        expect(addr.index).toBeLessThan(4);
        expect(addr.subIndex).toBeLessThan(4);
      });
    });

    it('generates addresses for all levels', () => {
      const addressing = new LatticeAddressing({ nLevels: 2, nPerLevel: 3 });
      const addresses = addressing.generateAddresses();
      expect(addresses.length).toBe(2 * 3 * 4); // 2 levels * 3 indices * 4 subIndices
    });

    it('builds adjacency list', () => {
      const addressing = new LatticeAddressing({ nLevels: 2, nPerLevel: 2 });
      const adjacency = addressing.buildAdjacencyList();
      expect(adjacency.size).toBe(2 * 2 * 4); // total addresses
      // Check that each entry has neighbors
      for (const [_key, neighbors] of adjacency) {
        expect(Array.isArray(neighbors)).toBe(true);
      }
    });
  });

  describe('latticeAddressFromFfe', () => {
    it('converts FFE bits to lattice address', () => {
      const bits = (2 << 11) | (100 << 2) | 1;
      const addr = latticeAddressFromFfe(bits, 3, 9);
      expect(addr.level).toBe(2);
      expect(addr.index).toBe(100);
      expect(addr.subIndex).toBe(1);
    });
  });

  describe('latticeAddressToString', () => {
    it('formats address as Llevel.index.subIndex', () => {
      const addr: SierpinskiLatticeAddress = { level: 5, index: 123, subIndex: 2 };
      const str = latticeAddressToString(addr);
      expect(str).toBe('L5.123.2');
    });
  });
});

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/aurora/memory/lattice-addressing.test.ts"
//   "update_script": "adm.exe"
//   "backup_path": "none"
//   "created_at": "2026-03-01T23:40:15.192899+00:00"
//   "new_hash": "f6cf29677004a1168c74300bc6cf7a4d"
//   "goal_id": "text_create_new_file"
//   "semantics": "Create unit test for lattice-addressing module."
//   "update_attrs": {"relative_path": "src/aurora/memory/lattice-addressing.test.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/aurora/memory/lattice-addressing.test.ts\""
// }
